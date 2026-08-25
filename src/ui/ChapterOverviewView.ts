import { TFile, TFolder, Vault, type TAbstractFile, type WorkspaceLeaf, ItemView, setIcon } from 'obsidian';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ChapterSorter } from '../services/ChapterSorter';
import { t } from '../i18n';
import { getCurrentBookContext, findBookRoot, type CurrentBookContextPlugin } from '../utils/path';
import { getDeterministicChapterDisplayOrder } from '../utils/chapterDisplayOrder';
import { CorkboardGridRenderer, type CorkboardGridPlugin } from './components/CorkboardGridRenderer';
import type { AccurateCountSettings } from '../types/settings';
import type { CacheManager } from '../services/CacheManager';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { HomepageManager } from '../services/HomepageManager';
import type { ForeshadowingManager } from '../services/ForeshadowingManager';
import { WorkbenchFilterIndex } from '../services/WorkbenchFilterIndex';

export const CORKBOARD_VIEW_TYPE = 'webnovel-corkboard';

export type ChapterOverviewSettings = Pick<
	AccurateCountSettings,
	| 'enableStrictChapterMode'
	| 'loreFolderName'
	| 'enableSmartChapterSort'
	| 'customSortOrder'
	| 'lorePopoverCollapse'
	| 'enableMobileLorePopover'
	| 'workspaceFolders'
	| 'timeline'
	| 'foreshadowing'
	| 'novelInfo'
>;

export type ChapterOverviewCacheManager = Pick<
	CacheManager,
	'isFileInWorkspace' | 'isEligibleForChapterList' | 'getFileCache'
>;

export type ChapterOverviewDebounceManager = Pick<
	AdaptiveDebounceManager,
	'debounceFixed' | 'cancel'
>;

export type ChapterOverviewHomepageManager = Pick<
	HomepageManager,
	'getHomepageFilePath' | 'getNovelFolders'
>;

export type ChapterOverviewForeshadowingManager = Pick<
	ForeshadowingManager,
	'findForeshadowingFile' | 'parseEntries'
>;

export interface ChapterOverviewViewPlugin
	extends Omit<CorkboardGridPlugin, 'settings'>,
		Omit<CurrentBookContextPlugin, 'settings' | 'homepageManager'> {
	settings: ChapterOverviewSettings;
	cacheManager: ChapterOverviewCacheManager;
	adaptiveDebounceManager: ChapterOverviewDebounceManager;
	homepageManager?: ChapterOverviewHomepageManager;
	foreshadowingManager?: ChapterOverviewForeshadowingManager;
	getTrackedMarkdownFiles(): TFile[];
	isFileInStrictChapterException(file: TFile): boolean;
}

export class ChapterOverviewView extends ItemView {
    private plugin: ChapterOverviewViewPlugin;
    private currentBookPath: string | null = null;
    private isSavingMetadata: boolean = false;
    private container!: HTMLElement;
    private readonly filterIndex: WorkbenchFilterIndex;
    private chapterFilterQuery: string = '';
    private filterDebounceTimer: number | null = null;
    private pendingFilterFocus: { start: number; end: number } | null = null;
    private isDescending: boolean = false;
    private currentRenderId: number = 0;

    constructor(leaf: WorkspaceLeaf, plugin: ChapterOverviewViewPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.filterIndex = new WorkbenchFilterIndex(this.app);

        // Listen to events for refresh and cache invalidation
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (this.isSavingMetadata) return;
            this.filterIndex.invalidate(oldPath);
            this.filterIndex.invalidate(file.path);
            this.plugin.adaptiveDebounceManager.debounceFixed('chapter-overview-refresh', () => {
                void this.reloadBoard();
            }, 500);
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (this.isSavingMetadata) return;
            this.filterIndex.invalidate(file.path);
            this.plugin.adaptiveDebounceManager.debounceFixed('chapter-overview-refresh', () => {
                void this.reloadBoard();
            }, 500);
        }));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (this.isSavingMetadata) return;
            if (file instanceof TFile && !this.plugin.cacheManager.isFileInWorkspace(file)) return;
            if (file instanceof TFile) this.filterIndex.invalidate(file.path);
            this.plugin.adaptiveDebounceManager.debounceFixed('chapter-overview-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));

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

        this.registerEvent(this.app.workspace.on('webnovel-workbench-book-changed', (bookPath: string) => {
            const folderStr = bookPath === '/' ? '/' : bookPath;
            if (folderStr && folderStr !== this.currentBookPath) {
                this.currentBookPath = folderStr;
                this.currentRenderId++;
                void this.reloadBoard();
            }
        }));
    }

    public setBookPath(path: string) {
        if (this.currentBookPath !== path) {
            this.currentBookPath = path;
            this.currentRenderId++;
            void this.reloadBoard();
        }
    }

    getViewType(): string {
        return CORKBOARD_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t('view.chapter-overview');
    }

    getIcon(): string {
        return 'library';
    }

    async onOpen() {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('wn-corkboard-container');
        this.currentBookPath = getCurrentBookContext(this.app, this.plugin) || null;
        await this.reloadBoard();
    }

    async onClose() {
        this.currentRenderId++;
        this.plugin.adaptiveDebounceManager.cancel('chapter-overview-refresh');
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
        const existingGrid = this.container.querySelector('.wn-corkboard-grid');
        if (existingGrid) scrollTop = existingGrid.scrollTop;

        if (!this.currentBookPath) {
            const emptyEl = buffer.createDiv('wn-corkboard-empty');
            emptyEl.setText(t('corkboard.no-book-open'));
            if (this.currentRenderId !== renderId) return;
            this.swapBuffer(buffer);
            return;
        }

        const folderPath = this.currentBookPath === '/' ? '' : this.currentBookPath;
        const folder = this.app.vault.getAbstractFileByPath(folderPath || '/');

        if (!(folder instanceof TFolder)) {
            const emptyEl = buffer.createDiv('wn-corkboard-empty');
            emptyEl.setText(t('corkboard.folder-not-found'));
            if (this.currentRenderId !== renderId) return;
            this.swapBuffer(buffer);
            return;
        }

        let bookFiles: TFile[];
        if (this.currentBookPath && this.currentBookPath !== '/') {
            const bookFolder = this.app.vault.getAbstractFileByPath(this.currentBookPath);
            if (bookFolder instanceof TFolder) {
                const list: TFile[] = [];
                Vault.recurseChildren(bookFolder, (child: TAbstractFile) => {
                    if (child instanceof TFile && child.extension === 'md' && this.plugin.cacheManager.isEligibleForChapterList(child)) {
                        list.push(child);
                    }
                });
                bookFiles = list;
            } else {
                bookFiles = this.plugin.getTrackedMarkdownFiles().filter(f => f.path.startsWith(this.currentBookPath + '/'));
            }
        } else {
            bookFiles = this.plugin.getTrackedMarkdownFiles();
        }

        const files = bookFiles.filter(file => {
            // 只有在开启严格章节模式时，才强制要求必须是章节命名格式
            if (this.plugin.settings.enableStrictChapterMode
                && !ChapterSorter.isChapterFile(file.name)
                && !this.plugin.isFileInStrictChapterException(file)) {
                return false;
            }
            // 排除设定文件夹
            const lorePath = this.plugin.settings.loreFolderName || t('common.default-lore-folder-name');
            if (file.path.includes(`/${lorePath}/`) || file.path.startsWith(`${lorePath}/`)) {
                return false;
            }
            return true;
        });

        const displayFiles = getDeterministicChapterDisplayOrder(files, {
            currentBookPath: this.currentBookPath || '',
            isDescending: this.isDescending,
            enableSmartChapterSort: this.plugin.settings.enableSmartChapterSort,
            customSortOrder: this.plugin.settings.customSortOrder
        });

        const filteredFiles = await this.filterIndex.filterChapters(
            displayFiles,
            this.chapterFilterQuery,
            (file) => {
                const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
                return frontmatter?.synopsis ?? frontmatter?.Synopsis ?? frontmatter?.['摘要'] ?? '';
            }
        );
        if (this.currentRenderId !== renderId) return;

        this.renderFilterBar(buffer, filteredFiles.length, files.length);

        if (filteredFiles.length === 0 && this.chapterFilterQuery.trim().length > 0) {
            buffer.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('corkboard.filter-no-results') });
        } else {
            const newGrid = buffer.createDiv('wn-corkboard-grid');

            // 解析伏笔
            const fmFolder = this.currentBookPath === '/' ? '' : (this.currentBookPath || '');
            const fFile = this.plugin.foreshadowingManager?.findForeshadowingFile(fmFolder);
            const foreshadowingMap = new Map<string, ParsedForeshadowingEntry[]>();

            if (fFile && this.plugin.foreshadowingManager) {
                const content = await this.app.vault.cachedRead(fFile);
                if (this.currentRenderId !== renderId) return;
                const entries = this.plugin.foreshadowingManager.parseEntries(content);
                const cleanFiles = filteredFiles.map(file => ({ file, cleanBase: file.basename.toLowerCase().replace(/\s+/g, '') }));
                for (const entry of entries) {
                    const targets: string[] = [];
                    const sources = new Set<string>();
                    if (entry.sourceFile) sources.add(entry.sourceFile);
                    if (entry.contents) {
                        entry.contents.forEach(c => {
                            if (c.source) sources.add(c.source);
                        });
                    }

                    if (entry.status === ForeshadowingStatus.Pending) {
                        targets.push(...sources);
                    } else if (entry.status === ForeshadowingStatus.PartiallyRecovered || entry.status === ForeshadowingStatus.Recovered) {
                        targets.push(...sources);
                        if (entry.recoveryLogs && entry.recoveryLogs.length > 0) {
                            targets.push(...entry.recoveryLogs.map(l => l.file));
                        } else {
                            const recFiles = entry.recoveryFiles ? [...entry.recoveryFiles] : (entry.recoveryFile ? [entry.recoveryFile] : []);
                            targets.push(...recFiles);
                        }
                    }
                    for (const target of targets) {
                        if (!target) continue;
                        const cleanTarget = target.toLowerCase().replace(/\s+/g, '');
                        for (const { file, cleanBase } of cleanFiles) {
                            if (cleanBase.includes(cleanTarget) || cleanTarget.includes(cleanBase)) {
                                const list = foreshadowingMap.get(file.basename) || [];
                                if (!list.includes(entry)) {
                                    list.push(entry);
                                    foreshadowingMap.set(file.basename, list);
                                }
                            }
                        }
                    }
                }
            }

            CorkboardGridRenderer.render({
                app: this.app,
                plugin: this.plugin,
                container: newGrid,
                files: filteredFiles,
                foreshadowingMap,
                draggable: false,
                currentBookPath: this.currentBookPath || '',
                onSaveStateChange: (isSaving) => { this.isSavingMetadata = isSaving; },
                maxLoreLines: 2
            });
        }

        if (this.currentRenderId !== renderId) return;
        this.swapBuffer(buffer);
        this.restorePendingFilterFocus();

        window.requestAnimationFrame(() => {
            const newGrid = this.container.querySelector('.wn-corkboard-grid');
            if (newGrid && scrollTop > 0) newGrid.scrollTop = scrollTop;
        });
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
            this.chapterFilterQuery = '';
            this.currentRenderId++;
            void this.reloadBoard();
        }
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
        input.value = this.chapterFilterQuery;
        input.placeholder = t('corkboard.filter-chapters-placeholder');
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

        const sortToggle = bar.createDiv('clickable-icon wn-workbench-sort-toggle');
        sortToggle.setAttr('role', 'button');
        sortToggle.setAttr('tabindex', '0');
        const label = this.isDescending ? t('corkboard.sort-descending') : t('corkboard.sort-ascending');
        sortToggle.setAttr('aria-label', label);
        sortToggle.setAttr('aria-pressed', this.isDescending ? 'true' : 'false');
        setIcon(sortToggle, this.isDescending ? 'arrow-down-narrow-wide' : 'arrow-up-wide-narrow');

        const toggleSort = () => {
            this.isDescending = !this.isDescending;
            this.currentRenderId++;
            void this.reloadBoard();
        };
        sortToggle.onclick = toggleSort;
        sortToggle.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleSort();
            }
        });

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
        this.chapterFilterQuery = input.value;
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
