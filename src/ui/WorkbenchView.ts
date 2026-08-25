import { TFile, TFolder, Vault, Component, type TAbstractFile, type WorkspaceLeaf, ItemView, Notice, Menu, Modal, Setting, setIcon } from 'obsidian';
import type { App, ViewStateResult } from 'obsidian';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import type { AccurateCountSettings } from '../types/settings';
import type { TaskSettings } from '../types/task';
import { ChapterSorter } from '../services/ChapterSorter';
import { getCurrentBookContext, findBookRoot, getLatestChapterFolderPath, type CurrentBookContextPlugin } from '../utils/path';
import { getDeterministicChapterDisplayOrder } from '../utils/chapterDisplayOrder';
import { t } from '../i18n';
import { getNovelStatusText, getNovelInfoLabel } from '../i18n/data-keys';
import { CorkboardGridRenderer, type CorkboardGridPlugin } from './components/CorkboardGridRenderer';
import { TimelineBoardRenderer, type TimelineBoardPlugin, type TimelineBoardTimelineManager } from './components/TimelineBoardRenderer';
import { LoreBoardRenderer, type LoreBoardPlugin, type LoreBoardRelationGraphManager, type LoreBoardCharacterManager } from './components/LoreBoardRenderer';
import { AddLoreModal, type AddLorePlugin } from './AddLoreModal';
import { DraggableListHelper } from '../utils/DraggableListHelper';
import { TouchDragPolyfill } from '../utils/TouchDragPolyfill';
import { TaskBoardRenderer, type TaskBoardPlugin, type TaskBoardManager } from './components/TaskBoardRenderer';
import { StickyNoteListRenderer, type StickyNoteListRendererPlugin, type StickyNoteListManager } from './components/StickyNoteListRenderer';
import { ForeshadowingBoardRenderer, type ForeshadowingBoardPlugin, type ForeshadowingBoardStatusManager } from './components/ForeshadowingBoardRenderer';
import { TaskAddModal } from './TaskModal';
import { isMobile } from '../utils';
import { Logger } from '../utils/Logger';
import { WorkbenchFilterIndex } from '../services/WorkbenchFilterIndex';
import { resolveChapterTemplate, type ChapterTemplateSettings } from '../utils/template';
import type { CacheManager } from '../services/CacheManager';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { HomepageManager } from '../services/HomepageManager';
import type { CharacterManager } from '../services/CharacterManager';
import type { ForeshadowingManager } from '../services/ForeshadowingManager';
import type { TaskManager } from '../services/TaskManager';
import type { MenuManager } from '../core/MenuManager';
import type { FileExplorerPatcher } from '../services/FileExplorerPatcher';

export type WorkbenchViewSettings = Pick<
	AccurateCountSettings,
	| 'enableStrictChapterMode'
	| 'loreFolderName'
	| 'customSortOrder'
	| 'corkboardSortMode'
	| 'loreBoardLayout'
	| 'enableSmartChapterSort'
	| 'nextNoteThemeIndex'
	| 'noteThemes'
	| 'enableChapterTemplate'
	| 'chapterTemplatePath'
	| 'chapterTemplatePaths'
	| 'workspaceFolders'
	| 'timeline'
	| 'foreshadowing'
	| 'novelInfo'
	| 'enableMobileLorePopover'
	| 'lorePopoverCollapse'
	| 'loreBoardActiveFile'
	| 'stickyNoteAutoSave'
	| 'immersive'
	| 'homepagePath'
> & {
	task?: Pick<TaskSettings, 'fileName'>;
};

export type WorkbenchCacheManager = Pick<
	CacheManager,
	'isFileInWorkspace' | 'isEligibleForChapterList' | 'getFileCache'
>;

export type WorkbenchDebounceManager = Pick<
	AdaptiveDebounceManager,
	'debounceFixed' | 'cancel'
>;

export type WorkbenchHomepageManager = Pick<
	HomepageManager,
	'getHomepageFilePath' | 'getNovelFolders' | 'findNovelInfoFile' | 'getNovelMetadata'
>;

export type WorkbenchCharacterManager = LoreBoardCharacterManager &
	Pick<CharacterManager, 'createLoreEntry'>;

export type WorkbenchForeshadowingManager = ForeshadowingBoardStatusManager &
	Pick<ForeshadowingManager, 'findForeshadowingFile' | 'parseEntries'>;

export type WorkbenchTimelineManager = TimelineBoardTimelineManager;

export type WorkbenchTaskManager = TaskBoardManager &
	Pick<TaskManager, 'loadEntries' | 'getNextPeriod' | 'addEntry' | 'getChapterWordCount'>;

export type WorkbenchStickyNoteManager = StickyNoteListManager;

export type WorkbenchMenuManager = Pick<
	MenuManager,
	'openChapterMerge' | 'toggleExcludeFromWordCount'
>;

export type WorkbenchFileExplorerPatcher = Pick<
	FileExplorerPatcher,
	'refreshAllExplorers'
>;

export type NewChapterModalSettings = ChapterTemplateSettings;

export interface NewChapterModalPlugin {
	settings: NewChapterModalSettings;
}

export interface WorkbenchViewPlugin
	extends Omit<CorkboardGridPlugin, 'settings'>,
		Omit<TimelineBoardPlugin, 'settings' | 'timelineManager' | 'characterManager' | 'cacheManager' | 'menuManager'>,
		Omit<LoreBoardPlugin, 'settings' | 'characterManager' | 'relationGraphManager' | 'saveSettings'>,
		Omit<TaskBoardPlugin, 'settings' | 'taskManager'>,
		Omit<StickyNoteListRendererPlugin, 'settings' | 'stickyNoteManager' | 'adaptiveDebounceManager' | 'getVaultMarkdownFiles' | 'saveSettings'>,
		Omit<ForeshadowingBoardPlugin, 'settings' | 'foreshadowingManager' | 'homepageManager'>,
		Omit<AddLorePlugin, 'characterManager'>,
		Omit<CurrentBookContextPlugin, 'settings' | 'homepageManager'>,
		Omit<NewChapterModalPlugin, 'settings'> {
	settings: WorkbenchViewSettings;
	cacheManager: WorkbenchCacheManager;
	adaptiveDebounceManager: WorkbenchDebounceManager;
	homepageManager?: WorkbenchHomepageManager;
	characterManager: WorkbenchCharacterManager;
	foreshadowingManager: WorkbenchForeshadowingManager;
	timelineManager: WorkbenchTimelineManager;
	taskManager: WorkbenchTaskManager;
	stickyNoteManager: WorkbenchStickyNoteManager;
	menuManager: WorkbenchMenuManager;
	relationGraphManager: LoreBoardRelationGraphManager;
	fileExplorerPatcher: WorkbenchFileExplorerPatcher;
	saveSettings(): Promise<void>;
	getTrackedMarkdownFiles(includeLore?: boolean): TFile[];
	getVaultMarkdownFiles(): TFile[];
	isFileInStrictChapterException(file: TFile): boolean;
	isPluginGeneratedFile(basename: string): boolean;
	calculateAccurateWords(content: string): number;
}

class NewChapterModal extends Modal {
    constructor(
        app: App, 
        private plugin: NewChapterModalPlugin,
        private defaultPrefix: string, 
        private onSubmit: (title: string, templateContent: string) => void
    ) {
        super(app);
    }
    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setHeading().setName(t('corkboard.new-chapter'));
        const inputEl = contentEl.createEl('input', { type: 'text', cls: 'wn-new-chapter-input' });
        inputEl.value = this.defaultPrefix;

        const btn = contentEl.createEl('button', { text: t('common.confirm') });
        btn.onclick = () => {
            const title = inputEl.value.trim();
            if (title) {
                resolveChapterTemplate(this.app, this.plugin.settings, (templateContent) => {
                    if (templateContent === null) {
                        return;
                    }
                    this.onSubmit(title, templateContent);
                    this.close();
                });
            }
        };
        inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btn.click();
        });
        window.setTimeout(() => {
            inputEl.focus();
            inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        }, 50);
    }
    onClose() { this.contentEl.empty(); }
}

class ConfirmModal extends Modal {
    constructor(app: App, private message: string, private onConfirm: () => void) {
        super(app);
    }
    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setHeading().setName(t('common.warning'));
        contentEl.createEl('p', { text: this.message });
        const btnContainer = contentEl.createDiv({ cls: 'webnovel-modal-button-container' });
        
        const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
        cancelBtn.onclick = () => this.close();
        
        const confirmBtn = btnContainer.createEl('button', { text: t('common.confirm'), cls: 'mod-warning' });
        confirmBtn.onclick = () => {
            this.onConfirm();
            this.close();
        };
    }
    onClose() { this.contentEl.empty(); }
}

export const WORKBENCH_VIEW_TYPE = 'webnovel-workbench';

export class WorkbenchView extends ItemView {
    private plugin: WorkbenchViewPlugin;
    public currentBookPath: string | null = null;
    private isSavingMetadata: boolean = false;
    private sortMode: 'default' | 'timeline' | 'lore' | 'foreshadowing' | 'task' | 'sticky' = 'default';
    private collapsedGroups: Set<string> = new Set();
    private container!: HTMLElement;
    private currentTimelineFilter: string = 'all';
    private currentForeshadowingTagFilter: string = 'all';
    private currentRenderId: number = 0;
    private draggableListCleanup: (() => void) | null = null;
    private touchPolyfillCleanup: (() => void) | null = null;
    private isReloadingBoard: boolean = false;
    private hasPendingReload: boolean = false;
    private currentBoardComponent: Component | null = null;
    private stickyNoteListRenderer: StickyNoteListRenderer | null = null;
    private cachedForeshadowingMap: Map<string, ParsedForeshadowingEntry[]> | null = null;
    private cachedForeshadowingBookPath: string | null = null;
    private chapterFilterQuery: string = '';
    private loreFilterQuery: string = '';
    private foreshadowingFilterQuery: string = '';
    private filterDebounceTimer: number | null = null;
    private pendingFilterFocus: { mode: 'default' | 'lore' | 'foreshadowing'; start: number; end: number } | null = null;
    private readonly filterIndex: WorkbenchFilterIndex;
    private isDescending: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: WorkbenchViewPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.filterIndex = new WorkbenchFilterIndex(this.app);

        // 监听 timeline 筛选事件
        this.registerEvent(this.app.workspace.on('timeline-filter-changed', (filter: string) => {
            this.currentTimelineFilter = filter;
            void this.reloadBoard();
        }));

        // 监听 foreshadowing 筛选事件
        this.registerEvent(this.app.workspace.on('foreshadowing-filter-changed', (tag: string) => {
            this.currentForeshadowingTagFilter = tag;
            void this.reloadBoard();
        }));

        // 监听文件或元数据变化以刷新视图
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (this.isSavingMetadata) return;
            this.filterIndex.invalidate(oldPath);
            this.filterIndex.invalidate(file.path);
            this.plugin.adaptiveDebounceManager.debounceFixed('workbench-refresh', () => {
                void this.reloadBoard();
            }, 500);
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (this.isSavingMetadata) return;
            this.filterIndex.invalidate(file.path);
            this.plugin.adaptiveDebounceManager.debounceFixed('workbench-refresh', () => {
                void this.reloadBoard();
            }, 500);
        }));
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (this.isSavingMetadata) return;
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            if (!this.plugin.cacheManager.isFileInWorkspace(file)) return;
            this.filterIndex.invalidate(file.path);
            this.plugin.adaptiveDebounceManager.debounceFixed('workbench-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (this.isSavingMetadata) return;
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            if (!this.plugin.cacheManager.isFileInWorkspace(file)) return;
            this.filterIndex.invalidate(file.path);
            this.plugin.adaptiveDebounceManager.debounceFixed('workbench-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (!leaf || leaf.view.getViewType() !== 'markdown') return;
            const file = this.app.workspace.getActiveFile();
            if (!file) return;

            // 1. 如果焦点切换到了创作主页 (Homepage)，直接 return 忽略！保持在上一本作品
            const homepagePath = this.plugin.homepageManager?.getHomepageFilePath();
            if (homepagePath && (file.path === homepagePath || file.name === '创作主页.md')) {
                return;
            }

            // 2. 严格检索该文件是否属于某部小说作品根目录（非作品文件/独立笔记返回 ''）
            const bookRoot = findBookRoot(this.app, this.plugin, file, true);

            // 3. 如果该文件不属于任何小说作品（如点出了工作区、打开了独立笔记/草稿），
            // 行为同切换到创作主页/其他侧边栏视图一致：直接 return，不改变 currentBookPath，保持在上一本作品
            if (!bookRoot) return;

            // 4. 只有当确定属于新作品目录时，才进行工作台跟随切换
            if (bookRoot !== this.currentBookPath) {
                this.currentBookPath = bookRoot;
                void this.reloadBoard();
            }
        }));
        this.registerEvent(
            this.app.workspace.on('webnovel-workbench-lore-updated', () => {
                void this.reloadBoard();
            })
        );
        this.registerEvent(
            this.app.workspace.on('webnovel:notes-changed', () => {
                if (this.sortMode === 'sticky') {
					if (this.stickyNoteListRenderer) {
						this.stickyNoteListRenderer.syncNotesFromManager();
					} else {
						void this.reloadBoard();
					}
                }
            })
        );
    }



    public setBookPath(path: string) {
        if (this.currentBookPath !== path) {
            this.currentBookPath = path;
            this.cachedForeshadowingMap = null;
            void this.reloadBoard();
            this.app.workspace.trigger('webnovel-workbench-book-changed', path);
        }
    }

    private async handleChapterDrop(fromPath: string, toPath: string, insertAfter: boolean) {
        if (fromPath === toPath) return;

        // 【限制】：为了防止跨卷拖拽产生重命名的bug，默认拖拽只能在同一文件夹下进行
        const fromFolder = fromPath.substring(0, fromPath.lastIndexOf('/'));
        const toFolder = toPath.substring(0, toPath.lastIndexOf('/'));
        if (fromFolder !== toFolder) {
            new Notice(t('error.cross-volume-drag-not-supported'));
            return;
        }

        const rawFiles = this.getBookMarkdownFiles().filter((file: TFile) => {
            if (this.plugin.settings.enableStrictChapterMode 
                && !ChapterSorter.isChapterFile(file.name)
                && !this.plugin.isFileInStrictChapterException(file)) {
                return false;
            }
            const lorePath = this.plugin.settings.loreFolderName || t('common.default-lore-folder-name');
            if (file.path.includes(`/${lorePath}/`) || file.path.startsWith(`${lorePath}/`)) {
                return false;
            }
            return true;
        });
        
        const files = getDeterministicChapterDisplayOrder(rawFiles, {
            currentBookPath: this.currentBookPath || '',
            isDescending: false,
            enableSmartChapterSort: this.plugin.settings.enableSmartChapterSort,
            customSortOrder: this.plugin.settings.customSortOrder
        });

        const fromIdx = files.findIndex((f: TFile) => f.path === fromPath);
        const toIdx = files.findIndex((f: TFile) => f.path === toPath);
        if (fromIdx === -1 || toIdx === -1) return;

        let targetIdx = insertAfter ? toIdx + 1 : toIdx;
        if (fromIdx < targetIdx) targetIdx--; 

        if (fromIdx === targetIdx) return;

        const movedFile = files[fromIdx];
        const newFiles = [...files];
        newFiles.splice(fromIdx, 1);
        newFiles.splice(targetIdx, 0, movedFile);

        const startIdx = Math.min(fromIdx, targetIdx);
        const endIdx = Math.max(fromIdx, targetIdx);
        const affectedFiles = newFiles.slice(startIdx, endIdx + 1);

        const renameOperations: { file: TFile, oldName: string, newName: string, newPath: string }[] = [];
        const customOrderUpdates: Record<string, number> = { ...this.plugin.settings.customSortOrder };

        const originalSlots = files.slice(startIdx, endIdx + 1).map((f: TFile) => ({
            file: f,
            ext: ChapterSorter.extractChapterNumber(f.name)
        }));

        const isMainSequenceDecimal = originalSlots.every(s => Boolean(s.ext?.isDecimal));

        const mainSlots = originalSlots.filter(s => {
            if (!s.ext || s.ext.number === -1) return false;
            if (s.ext.isDecimal && !isMainSequenceDecimal) return false;
            return true;
        });

        const mainFiles = affectedFiles.filter(f => {
            const ext = ChapterSorter.extractChapterNumber(f.name);
            if (!ext || ext.number === -1) return false;
            if (ext.isDecimal && !isMainSequenceDecimal) return false;
            return true;
        });

        if (mainSlots.length === mainFiles.length && mainSlots.length > 0) {
            for (let i = 0; i < mainFiles.length; i++) {
                const file = mainFiles[i];
                const targetSlot = mainSlots[i];
                
                if (file.path === targetSlot.file.path) continue;
                
                const ext = ChapterSorter.extractChapterNumber(file.name);
                if (!ext || !ext.numStr || !ext.rulePattern) continue;

                const targetExt = targetSlot.ext;
                if (!targetExt) continue;

                let newNumStr = targetExt.number.toString();
                if (ext.isChinese) {
                    newNumStr = ChapterSorter.toChineseNumber(targetExt.number);
                } else {
                    if (ext.numStr.startsWith('0') && !newNumStr.startsWith('0')) {
                        newNumStr = newNumStr.padStart(ext.numStr.length, '0');
                    }
                }

                const numStr = ext.numStr;
                const regex = new RegExp(ext.rulePattern, 'i');
                const newBasename = file.basename.replace(regex, (match: string, p1: string, p2: string) => {
                    if (p1 === numStr) return match.replace(p1, newNumStr);
                    if (p2 === numStr) return match.replace(p2, newNumStr);
                    return match.replace(numStr, newNumStr);
                });
                
                const newName = `${newBasename}.md`;
                const newPath = file.parent && file.parent.path !== '/' ? `${file.parent.path}/${newName}` : newName;
                
                if (newPath !== file.path) {
                    renameOperations.push({ file, oldName: file.name, newName, newPath });
                }
            }
        }

        let hasCollision = false;
        let collisionMsg = '';
        for (const op of renameOperations) {
            const existing = this.app.vault.getAbstractFileByPath(op.newPath);
            if (existing && !renameOperations.some(o => o.file.path === op.newPath)) {
                hasCollision = true;
                collisionMsg = op.newPath;
                break;
            }
        }

        const executeRenames = async () => {
            this.isSavingMetadata = true;
            try {
                // Step 1: Rename to temporary paths to avoid collisions
                const tempOps = renameOperations.map(op => {
                    const tempPath = op.newPath + '_temp_' + Date.now();
                    return { ...op, tempPath };
                });
                
                const completedStep1: Array<{ file: TFile; originalPath: string }> = [];
                try {
                    for (const op of tempOps) {
                        const originalPath = op.file.path;
                        await this.app.fileManager.renameFile(op.file, op.tempPath);
                        completedStep1.push({ file: op.file, originalPath });
                    }
                } catch (step1Err) {
                    for (const { file, originalPath } of completedStep1.reverse()) {
                        try { await this.app.fileManager.renameFile(file, originalPath); } catch { /* rollback best effort */ }
                    }
                    throw step1Err;
                }

                // Step 2: Rename from temporary paths to final paths
                const completedStep2: Array<{ file: TFile; tempPath: string }> = [];
                try {
                    for (const op of tempOps) {
                        const tempPath = op.file.path;
                        await this.app.fileManager.renameFile(op.file, op.newPath);
                        completedStep2.push({ file: op.file, tempPath });
                    }
                } catch (step2Err) {
                    for (const { file, tempPath } of completedStep2.reverse()) {
                        try { await this.app.fileManager.renameFile(file, tempPath); } catch { /* rollback best effort */ }
                    }
                    for (const { file, originalPath } of completedStep1.reverse()) {
                        try { await this.app.fileManager.renameFile(file, originalPath); } catch { /* rollback best effort */ }
                    }
                    throw step2Err;
                }
                
                newFiles.forEach((f, idx) => {
                    const finalPath = renameOperations.find(op => op.file === f)?.newPath || f.path;
                    customOrderUpdates[finalPath] = idx;
                });
                
                this.plugin.settings.customSortOrder = customOrderUpdates;
                await this.plugin.saveSettings();
                this.plugin.fileExplorerPatcher.refreshAllExplorers();
                void this.reloadBoard();
            } catch (e) {
                new Notice(t('workbench.rename-failed', { error: String(e) }) || ('重命名失败: ' + String(e)));
            } finally {
                window.setTimeout(() => { this.isSavingMetadata = false; }, 500);
            }
        };

        if (hasCollision) {
            new ConfirmModal(this.app, t('workbench.confirm-overwrite-rename', { name: collisionMsg }) || `目标文件 ${collisionMsg} 已存在，是否强制覆盖重命名？`, () => {
                void executeRenames();
            }).open();
        } else {
            void executeRenames();
        }
    }
    getState(): Record<string, unknown> {
        return {
            ...super.getState(),
            currentBookPath: this.currentBookPath
        };
    }

    async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);
        if (state.currentBookPath) {
            this.currentBookPath = state.currentBookPath as string;
            void this.reloadBoard();
            this.app.workspace.trigger('webnovel-workbench-book-changed', this.currentBookPath);
        }
    }
    getViewType(): string {
        return WORKBENCH_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t('view.workbench');
    }

    getIcon(): string {
        return 'laptop';
    }

    async onOpen(): Promise<void> {
        this.sortMode = this.plugin.settings.corkboardSortMode || 'default';
        if (isMobile() && this.sortMode === 'sticky') {
            this.sortMode = 'default';
        }
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('wn-corkboard-container');
        
        if (this.touchPolyfillCleanup) {
            this.touchPolyfillCleanup();
        }
        this.touchPolyfillCleanup = TouchDragPolyfill.register(this.containerEl);

        if (this.draggableListCleanup) {
            this.draggableListCleanup();
        }
        this.draggableListCleanup = DraggableListHelper.init({
            container: this.container,
            itemSelector: '.wn-corkboard-card',
            dragDataMimeType: 'application/wn-chapter-path',
            getDragData: (el) => el.getAttribute('data-path') || '',
            canDrag: () => this.sortMode === 'default' && !this.isDescending,
            onDrop: (fromPath, toPath, insertAfter) => {
                if (this.sortMode !== 'default' || this.isDescending) return;
                void this.handleChapterDrop(fromPath, toPath, insertAfter);
            }
        });

        // 确定当前所处的作品目录
        if (!this.currentBookPath) {
            const context = getCurrentBookContext(this.app, this.plugin);
            this.currentBookPath = (context === '' || context === null) ? '/' : context;
        }
        if (this.currentBookPath) {
            this.app.workspace.trigger('webnovel-workbench-book-changed', this.currentBookPath);
        }

        await this.renderBoard();
    }

    async onClose(): Promise<void> {
        this.currentRenderId++;
        this.plugin.adaptiveDebounceManager.cancel('workbench-refresh');
        if (this.currentBoardComponent) {
            this.removeChild(this.currentBoardComponent);
            this.currentBoardComponent.unload();
            this.currentBoardComponent = null;
        }
        if (this.filterDebounceTimer !== null) {
            window.clearTimeout(this.filterDebounceTimer);
            this.filterDebounceTimer = null;
        }
        this.filterIndex.clear();
        if (this.touchPolyfillCleanup) {
            this.touchPolyfillCleanup();
            this.touchPolyfillCleanup = null;
        }
        if (this.draggableListCleanup) {
            this.draggableListCleanup();
            this.draggableListCleanup = null;
        }
        this.container.empty();
    }

    private renderFilterBar(
        container: HTMLElement,
        mode: 'default' | 'lore' | 'foreshadowing',
        matchedCount: number,
        totalCount: number
    ): void {
        const query = mode === 'default' ? this.chapterFilterQuery : (mode === 'lore' ? this.loreFilterQuery : this.foreshadowingFilterQuery);
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
        input.value = query;
        input.placeholder = mode === 'default'
            ? t('corkboard.filter-chapters-placeholder')
            : (mode === 'lore' ? t('corkboard.filter-lore-placeholder') : t('corkboard.filter-foreshadowing-placeholder'));
        input.setAttr('aria-label', input.placeholder);
        input.setAttr('autocomplete', 'off');
        input.setAttr('data-filter-mode', mode);
        input.spellcheck = false;

        const clearButton = inputWrapper.createDiv('clickable-icon wn-workbench-filter-clear');
        clearButton.setAttr('role', 'button');
        clearButton.setAttr('tabindex', '0');
        clearButton.setAttr('aria-label', t('corkboard.filter-clear'));
        clearButton.title = t('corkboard.filter-clear');
        setIcon(clearButton, 'x');

        const updateClearButton = () => {
            const isVisible = input.value.length > 0;
            clearButton.toggleClass('is-visible', isVisible);
            clearButton.setAttr('aria-hidden', isVisible ? 'false' : 'true');
        };
        updateClearButton();

        if (mode === 'default') {
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
        }

        if (mode === 'lore') {
            const layoutSwitcher = bar.createDiv('wn-lore-board-layout-switcher');
            const layoutMode = this.plugin.settings.loreBoardLayout || 'table';
            const modes = [
                { id: 'table', icon: 'list', label: t('lore.tab-table') },
                { id: 'cards', icon: 'layout-grid', label: t('lore.tab-card') },
                { id: 'graph', icon: 'network', label: t('lore.tab-graph') }
            ] as const;

            for (const m of modes) {
                const btn = layoutSwitcher.createDiv(`wn-lore-board-switcher-btn ${layoutMode === m.id ? 'is-active' : ''}`);
                setIcon(btn, m.icon);
                btn.title = m.label;
                btn.onclick = async () => {
                    if (this.plugin.settings.loreBoardLayout === m.id) return;
                    this.plugin.settings.loreBoardLayout = m.id;
                    await this.plugin.saveSettings();
                    void this.reloadBoard();
                };
            }
        }

        let isComposing = false;
        input.addEventListener('compositionstart', () => {
            isComposing = true;
            // Do not allow a previous query render to replace the input during IME composition.
            this.currentRenderId++;
            if (this.filterDebounceTimer !== null) {
                window.clearTimeout(this.filterDebounceTimer);
                this.filterDebounceTimer = null;
            }
        });
        input.addEventListener('compositionend', () => {
            isComposing = false;
            updateClearButton();
            this.scheduleFilterRefresh(mode, input);
        });
        input.addEventListener('input', (event) => {
            updateClearButton();
            if (isComposing || (event as unknown as { isComposing?: boolean }).isComposing) return;
            this.scheduleFilterRefresh(mode, input);
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
            this.scheduleFilterRefresh(mode, input, true);
        });
        clearButton.onclick = () => {
            input.value = '';
            updateClearButton();
            this.scheduleFilterRefresh(mode, input, true);
        };
        clearButton.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            clearButton.click();
        });
    }

    private scheduleFilterRefresh(mode: 'default' | 'lore' | 'foreshadowing', input: HTMLInputElement, immediate: boolean = false): void {
        if (mode === 'default') this.chapterFilterQuery = input.value;
        else if (mode === 'lore') this.loreFilterQuery = input.value;
        else this.foreshadowingFilterQuery = input.value;

        this.pendingFilterFocus = {
            mode,
            start: input.selectionStart ?? input.value.length,
            end: input.selectionEnd ?? input.value.length
        };

        // Cancel any in-flight render so an older query can never replace newer input.
        this.currentRenderId++;
        if (this.filterDebounceTimer !== null) window.clearTimeout(this.filterDebounceTimer);
        this.filterDebounceTimer = window.setTimeout(() => {
            this.filterDebounceTimer = null;
            void this.reloadBoard();
        }, immediate ? 0 : 200);
    }

    private restorePendingFilterFocus(): void {
        const pending = this.pendingFilterFocus;
        if (!pending || this.sortMode !== pending.mode) return;

        const input = this.container.querySelector<HTMLInputElement>(
            `.wn-workbench-filter-input[data-filter-mode="${pending.mode}"]`
        );
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
        const mode = (this.sortMode === 'lore') ? 'lore' : (this.sortMode === 'foreshadowing' ? 'foreshadowing' : 'default');
        const input = this.container.querySelector<HTMLInputElement>(
            `.wn-workbench-filter-input[data-filter-mode="${mode}"]`
        );
        if (input) {
            input.value = '';
            const clearButton = input.parentElement?.querySelector<HTMLElement>('.wn-workbench-filter-clear');
            if (clearButton) {
                clearButton.classList.remove('is-visible');
                clearButton.setAttribute('aria-hidden', 'true');
            }
            this.scheduleFilterRefresh(mode, input, true);
        } else {
            if (mode === 'default') this.chapterFilterQuery = '';
            else if (mode === 'lore') this.loreFilterQuery = '';
            else this.foreshadowingFilterQuery = '';
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

    public async reloadBoard(): Promise<void> {
        if (!this.container) return;
        if (this.isReloadingBoard) {
            this.hasPendingReload = true;
            return;
        }
        this.isReloadingBoard = true;

        try {
            let timelineScrollTop = 0;
            let sidebarScrollTop = 0;
            let defaultScrollTop = 0;
            if (this.sortMode === 'timeline') {
                const mainCol = this.container.querySelector('.wn-timeline-waterfall-main') as HTMLElement;
                if (mainCol) timelineScrollTop = mainCol.scrollTop;
                const sideCol = this.container.querySelector('.wn-timeline-waterfall-sidebar') as HTMLElement;
                if (sideCol) sidebarScrollTop = sideCol.scrollTop;
            } else {
                defaultScrollTop = this.container.scrollTop;
            }

            if (this.currentBookPath) {
                await this.renderBoard();
            } else {
                this.container.empty();
                const header = this.container.createDiv('wn-corkboard-header');
                header.createDiv({ text: t('view.workbench'), cls: 'wn-corkboard-title' });
                header.createEl('p', {
                    text: t('corkboard.please-open-file'),
                    cls: 'wn-corkboard-hint'
                });
            }

            if (this.sortMode === 'timeline') {
                window.requestAnimationFrame(() => {
                    const mainCol = this.container.querySelector('.wn-timeline-waterfall-main') as HTMLElement;
                    if (mainCol) mainCol.scrollTop = timelineScrollTop;
                    const sideCol = this.container.querySelector('.wn-timeline-waterfall-sidebar') as HTMLElement;
                    if (sideCol) sideCol.scrollTop = sidebarScrollTop;
                });
            } else {
                this.container.scrollTop = defaultScrollTop;
            }
        } finally {
            this.isReloadingBoard = false;
            if (this.hasPendingReload) {
                this.hasPendingReload = false;
                void this.reloadBoard();
            }
        }
    }

    private async renderBoard(): Promise<void> {
        const tStart = performance.now();
        const renderId = ++this.currentRenderId;
        const buffer = createDiv();

        const header = buffer.createDiv('wn-corkboard-header');
        header.createDiv({ text: t('view.workbench'), cls: 'wn-corkboard-title' });

        if (!this.currentBookPath) {
            header.createEl('p', {
                text: t('corkboard.please-open-file'),
                cls: 'wn-corkboard-hint'
            });
            if (this.currentRenderId !== renderId) return;
            const fragment = (window as unknown as { createFragment: () => DocumentFragment }).createFragment();
            while (buffer.firstChild) fragment.appendChild(buffer.firstChild);
            this.container.empty();
            this.container.appendChild(fragment);
            return;
        }

        let displayBookName = t('corkboard.vault-root');
        if (this.currentBookPath && this.currentBookPath !== '/') {
            const parts = this.currentBookPath.split('/');
            displayBookName = parts[parts.length - 1];
        }

        const hintEl = header.createEl('p', { cls: 'wn-corkboard-hint' });
        hintEl.appendText(t('corkboard.current-novel', { name: displayBookName }) + ' ');
        const switchSpan = hintEl.createSpan({ text: t('corkboard.click-to-switch'), cls: 'wn-corkboard-switch-novel' });

        switchSpan.onclick = (e) => {
            const menu = new Menu();
            const novels = this.plugin.homepageManager!.getNovelFolders();
            for (const novel of novels) {
                menu.addItem((item) => {
                    item.setTitle(novel.metadata?.name || novel.folderName)
                        .setIcon('book')
                        .onClick(() => {
                            this.setBookPath(novel.folderPath);
                        });
                });
            }
            menu.showAtMouseEvent(e);
        };

        // 获取该作品下所有章节文件
        const rawFiles = this.getBookMarkdownFiles().filter((file: TFile) => {
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

        const files = rawFiles;
        if (this.plugin.settings.enableSmartChapterSort) {
            const customOrder = this.plugin.settings.customSortOrder || {};
            files.sort((a: TFile, b: TFile) => ChapterSorter.compareFilesWithCustomOrder(a, b, customOrder));
        } else {
            // 否则按文件名简单排序
            files.sort((a: TFile, b: TFile) => a.basename.localeCompare(b.basename));
        }
        const tFiles = performance.now();
        Logger.info(`[Perf Phase] Workbench.getFiles & sort: ${(tFiles - tStart).toFixed(2)}ms`);

        // 解析伏笔（获取待回收列表并构建映射表，带内存 Cache 防重复建模）
        let foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>;

        if (this.cachedForeshadowingMap && this.cachedForeshadowingBookPath === this.currentBookPath) {
            foreshadowingMap = this.cachedForeshadowingMap;
        } else {
            let foreshadowings: ParsedForeshadowingEntry[] = [];
            if (this.currentBookPath && this.plugin.foreshadowingManager) {
                const fmFolder = this.currentBookPath === '/' ? '' : this.currentBookPath;
                const fFile = this.plugin.foreshadowingManager.findForeshadowingFile(fmFolder);
                if (fFile) {
                    const content = await this.app.vault.cachedRead(fFile);
                    foreshadowings = this.plugin.foreshadowingManager.parseEntries(content);
                }
            }

            const cleanBaseMap = new Map<TFile, string>();
            for (const file of files) {
                cleanBaseMap.set(file, file.basename.toLowerCase().replace(/\s+/g, ''));
            }

            foreshadowingMap = new Map<string, ParsedForeshadowingEntry[]>();
            for (const entry of foreshadowings) {
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
                    if (!cleanTarget) continue;

                    for (const file of files) {
                        const cleanBase = cleanBaseMap.get(file) || '';
                        if (!cleanBase) continue;
                        // 单字符要求精确匹配，多字符允许双向包含匹配，防止 "1" 或 "章" 等通用单字符在大型笔记库中引发失控重匹配
                        const isMatched = cleanTarget.length >= 2
                            ? (cleanBase.includes(cleanTarget) || cleanTarget.includes(cleanBase))
                            : cleanBase === cleanTarget;

                        if (isMatched) {
                            const list = foreshadowingMap.get(file.basename) || [];
                            if (!list.includes(entry)) {
                                list.push(entry);
                                foreshadowingMap.set(file.basename, list);
                            }
                        }
                    }
                }
            }
            this.cachedForeshadowingMap = foreshadowingMap;
            this.cachedForeshadowingBookPath = this.currentBookPath;
        }

        const tForeshadowing = performance.now();
        Logger.info(`[Perf Phase] Workbench.foreshadowingMap: ${(tForeshadowing - tFiles).toFixed(2)}ms`);

        // 头部按钮容器（样式由 .wn-corkboard-header-buttons 管理）
        const buttonsContainer = header.createDiv('wn-corkboard-header-buttons');

        if (this.sortMode === 'default') {
            const bookFolderPath = this.currentBookPath === '/' ? '/' : (this.currentBookPath || '');
            const bookFolder = this.app.vault.getAbstractFileByPath(bookFolderPath || '/');
            if (bookFolder instanceof TFolder) {
                const mergeChaptersBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-merge-chapters-btn' });
                mergeChaptersBtn.textContent = t('menu.merge-chapters');
                mergeChaptersBtn.onclick = () => {
                    void this.plugin.menuManager.openChapterMerge(bookFolder).catch(console.error);
                };
            }
        }

        const infoFile = this.plugin.homepageManager?.findNovelInfoFile(this.currentBookPath || '');
        if (infoFile) {
            const meta = await this.plugin.homepageManager?.getNovelMetadata(this.currentBookPath || '');
            let currentStatus = meta?.status || 'ongoing';

            const statusBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-novel-status-btn' });
            statusBtn.textContent = getNovelStatusText(currentStatus);
            statusBtn.onclick = (e: MouseEvent) => {
                const menu = new Menu();
                const statuses = ['ongoing', 'stockpiling', 'paused', 'completed'] as const;
                for (const st of statuses) {
                    menu.addItem((item) => {
                        item.setTitle(getNovelStatusText(st))
                            .setChecked(currentStatus === st)
                            .onClick(async () => {
                                currentStatus = st;
                                statusBtn.setText(getNovelStatusText(st));
                                await this.app.vault.process(infoFile, (data) => {
                                    return data.split(/\r?\n/).map(line => {
                                        const match = line.match(/\*\*(.+?)\*\*[：:]\s*(.*)/);
                                        if (match) {
                                            const label = match[1];
                                            if (label === getNovelInfoLabel('status') || label === '状态' || label === 'Status') {
                                                return `**${label}**：${getNovelStatusText(st)}`;
                                            }
                                        }
                                        return line;
                                    }).join('\n');
                                });
                                new Notice(t('corkboard.status-updated', { status: getNovelStatusText(st) }) || `状态已更新：${getNovelStatusText(st)}`);
                            });
                    });
                }
                menu.showAtMouseEvent(e);
            };
        }

        if (this.sortMode === 'lore') {
            const newLoreBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-new-lore-btn' });
            newLoreBtn.textContent = t('modal.add-new-lore');
            newLoreBtn.onclick = () => {
                new AddLoreModal(this.app, this.plugin, '', this.currentBookPath || '').open();
            };
        } else if (this.sortMode === 'task') {
            const newTaskBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-new-task-btn mod-cta' });
            newTaskBtn.textContent = t('modal.new-task') || '添加任务';
            newTaskBtn.onclick = async () => {
                const bookFolder = this.currentBookPath === '/' ? '' : (this.currentBookPath || '');
                const manager = this.plugin.taskManager;

                const existingEntries = await manager.loadEntries(bookFolder);
                const nextPeriod = manager.getNextPeriod(existingEntries || []);
                const lastPlatform = existingEntries && existingEntries.length > 0
                    ? existingEntries[existingEntries.length - 1].platform
                    : '';

                new TaskAddModal(
                    this.app,
                    manager,
                    nextPeriod,
                    lastPlatform,
                    async (entry) => {
                        await manager.addEntry(entry, bookFolder);
                        new Notice(t('notice.task-added') || '任务已添加');
                        void this.reloadBoard();
                    },
                    bookFolder
                ).open();
            };
        } else if (this.sortMode === 'sticky') {
            const newStickyBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-new-sticky-btn mod-cta' });
            newStickyBtn.textContent = t('immersive.new-blank-note');
            newStickyBtn.onclick = () => {
                if (this.stickyNoteListRenderer) {
                    this.stickyNoteListRenderer.createNewNote();
                }
            };
        } else {
            // 右上角：新增章节按钮
            const newChapterBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-new-chapter-btn' });
            newChapterBtn.textContent = t('corkboard.new-chapter');
            newChapterBtn.onclick = () => {
                const chapterFolder = getLatestChapterFolderPath(this.currentBookPath || '/', files);
                const siblingFiles = files.filter((file: TFile) => file.parent?.path === chapterFolder);
                const namingFiles = siblingFiles.length > 0 ? siblingFiles : files;
                let defaultPrefix = '01 ';
                if (namingFiles.length > 0) {
                    const siblingNames = namingFiles.map((f: TFile) => f.basename);
                    for (let i = namingFiles.length - 1; i >= 0; i--) {
                        const nextName = ChapterSorter.getNextChapterName(namingFiles[i].basename, siblingNames);
                        if (nextName) {
                            defaultPrefix = nextName.replace(/\.md$/, '').trimEnd() + ' ';
                            break;
                        }
                    }
                }

                new NewChapterModal(this.app, this.plugin, defaultPrefix, (title, templateContent) => {
                    const folder = chapterFolder === '/' ? '' : (chapterFolder + '/');
                    const newPath = folder + title + '.md';
                    this.isSavingMetadata = true;
                    this.app.vault.create(newPath, templateContent).then(_file => {
                        new Notice((t('corkboard.new-chapter-success')) + title);
                        // 留在工作台，仅刷新面?
                        void this.reloadBoard();
                        window.setTimeout(() => {
                            this.isSavingMetadata = false;
                        }, 1500); // 避免 metadataCache changed 事件引发的二次刷新跳?
                    }).catch(e => {
                        this.isSavingMetadata = false;
                        console.error(e);
                        new Notice(t('corkboard.new-chapter-failed'));
                    });
                }).open();
            };
        }

        // 渲染顶部的多个 Toggle 切换按钮
        const toggleGroup = header.createDiv('wn-corkboard-toggle-group');

        const btnDefault = toggleGroup.createSpan({
            text: t('corkboard.sort-default'),
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'default' ? 'active' : ''}`
        });

        const btnTimeline = toggleGroup.createSpan({
            text: t('corkboard.sort-timeline'),
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'timeline' ? 'active' : ''}`
        });

        const btnLore = toggleGroup.createSpan({
            text: t('corkboard.sort-lore'),
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'lore' ? 'active' : ''}`
        });

        const btnForeshadowing = toggleGroup.createSpan({
            text: t('corkboard.sort-foreshadowing') || '伏笔看板',
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'foreshadowing' ? 'active' : ''}`
        });

        const btnTask = toggleGroup.createSpan({
            text: t('view.task') || '任务看板',
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'task' ? 'active' : ''}`
        });

        let btnSticky: HTMLElement | null = null;
        if (!isMobile()) {
            btnSticky = toggleGroup.createSpan({
                text: t('view.immersive-sticky-notes') || '便签管理',
                cls: `wn-corkboard-toggle-btn ${this.sortMode === 'sticky' ? 'active' : ''}`
            });
        }

        const saveSortMode = () => {
            this.plugin.adaptiveDebounceManager.debounceFixed('save-corkboard-sort-mode', () => {
                void this.plugin.saveSettings();
            }, 2000);
        };

        const updateButtonActive = (activeBtn: HTMLElement) => {
            toggleGroup.querySelectorAll('.wn-corkboard-toggle-btn').forEach(b => b.removeClass('active'));
            activeBtn.addClass('active');
        };

        btnDefault.onclick = () => {
            if (this.sortMode === 'default') return;
            updateButtonActive(btnDefault);
            this.sortMode = 'default';
            this.plugin.settings.corkboardSortMode = 'default';
            saveSortMode();
            void this.reloadBoard();
        };

        btnTimeline.onclick = () => {
            if (this.sortMode === 'timeline') return;
            updateButtonActive(btnTimeline);
            this.sortMode = 'timeline';
            this.plugin.settings.corkboardSortMode = 'timeline';
            saveSortMode();
            void this.reloadBoard();
        };

        btnLore.onclick = () => {
            if (this.sortMode === 'lore') return;
            updateButtonActive(btnLore);
            this.sortMode = 'lore';
            this.plugin.settings.corkboardSortMode = 'lore';
            saveSortMode();
            void this.reloadBoard();
        };

        btnForeshadowing.onclick = () => {
            if (this.sortMode === 'foreshadowing') return;
            updateButtonActive(btnForeshadowing);
            this.sortMode = 'foreshadowing';
            this.plugin.settings.corkboardSortMode = 'foreshadowing';
            saveSortMode();
            void this.reloadBoard();
        };

        btnTask.onclick = () => {
            if (this.sortMode === 'task') return;
            updateButtonActive(btnTask);
            this.sortMode = 'task';
            this.plugin.settings.corkboardSortMode = 'task';
            saveSortMode();
            void this.reloadBoard();
        };

        if (btnSticky) {
            btnSticky.onclick = () => {
                if (this.sortMode === 'sticky') return;
                updateButtonActive(btnSticky);
                this.sortMode = 'sticky';
                this.plugin.settings.corkboardSortMode = 'sticky';
                saveSortMode();
                void this.reloadBoard();
            };
        }

        if (this.currentBoardComponent) {
            this.removeChild(this.currentBoardComponent);
            this.currentBoardComponent.unload();
            this.currentBoardComponent = null;
        }
        this.currentBoardComponent = this.addChild(new Component());

        let filteredChapterFiles = files;
        let matchedLoreHeadings: ReadonlySet<string> | undefined;
        let foreshadowingEntriesList: ParsedForeshadowingEntry[] = [];
        let foreshadowingFileObj: TFile | null = null;

        if (this.sortMode === 'default') {
            const displayFiles = getDeterministicChapterDisplayOrder(files, {
                currentBookPath: this.currentBookPath || '',
                isDescending: this.isDescending,
                enableSmartChapterSort: this.plugin.settings.enableSmartChapterSort,
                customSortOrder: this.plugin.settings.customSortOrder
            });
            filteredChapterFiles = await this.filterIndex.filterChapters(
                displayFiles,
                this.chapterFilterQuery,
                (file) => {
                    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
                    return frontmatter?.synopsis ?? frontmatter?.Synopsis ?? frontmatter?.['摘要'] ?? '';
                }
            );
            if (this.currentRenderId !== renderId) return;
            this.renderFilterBar(header, 'default', filteredChapterFiles.length, files.length);
        } else if (this.sortMode === 'lore') {
            await this.plugin.characterManager.ensureInitialized();
            const normalizedBookPath = this.currentBookPath === '' ? '/' : this.currentBookPath;
            const loreEntries = this.plugin.characterManager.getLoreEntriesInFileOrder(normalizedBookPath);
            const hasQuery = this.loreFilterQuery.trim().length > 0;

            if (hasQuery) {
                matchedLoreHeadings = await this.filterIndex.filterLoreEntries(
                    loreEntries,
                    this.getLoreAliases(normalizedBookPath),
                    this.loreFilterQuery
                );
            }
            if (this.currentRenderId !== renderId) return;
            this.renderFilterBar(
                header,
                'lore',
                matchedLoreHeadings?.size ?? loreEntries.length,
                loreEntries.length
            );
        } else if (this.sortMode === 'foreshadowing') {
            if (this.currentBookPath && this.plugin.foreshadowingManager) {
                const fmFolder = this.currentBookPath === '/' ? '' : this.currentBookPath;
                foreshadowingFileObj = this.plugin.foreshadowingManager.findForeshadowingFile(fmFolder);
                if (foreshadowingFileObj) {
                    const content = await this.app.vault.cachedRead(foreshadowingFileObj);
                    foreshadowingEntriesList = this.plugin.foreshadowingManager.parseEntries(content);
                }
            }
            if (this.currentRenderId !== renderId) return;

            const fQuery = this.foreshadowingFilterQuery.trim().toLowerCase();
            const tagFilter = this.currentForeshadowingTagFilter;
            let matchedForeshadowingCount = foreshadowingEntriesList.length;
            if (fQuery || (tagFilter && tagFilter !== 'all')) {
                matchedForeshadowingCount = foreshadowingEntriesList.filter(entry => {
                    if (tagFilter && tagFilter !== 'all' && !entry.tags.includes(tagFilter)) return false;
                    if (!fQuery) return true;
                    if (entry.description.toLowerCase().includes(fQuery)) return true;
                    if (entry.tags.some(t => t.toLowerCase().includes(fQuery))) return true;
                    if (entry.contents.some(c => c.text.toLowerCase().includes(fQuery) || (c.source && c.source.toLowerCase().includes(fQuery)))) return true;
                    if (entry.recoveryLogs && entry.recoveryLogs.some(l => (l.note && l.note.toLowerCase().includes(fQuery)) || (l.quote && l.quote.toLowerCase().includes(fQuery)) || l.file.toLowerCase().includes(fQuery))) return true;
                    return false;
                }).length;
            }

            this.renderFilterBar(
                header,
                'foreshadowing',
                matchedForeshadowingCount,
                foreshadowingEntriesList.length
            );
        }

        if (this.sortMode === 'timeline') {
            await TimelineBoardRenderer.render({
                app: this.app,
                plugin: this.plugin,
                ownerComponent: this.currentBoardComponent,
                container: buffer,
                files,
                foreshadowingMap,
                currentBookPath: this.currentBookPath || '',
                currentTimelineFilter: this.currentTimelineFilter,
                onSaveStateChange: (isSaving) => { this.isSavingMetadata = isSaving; },
                reloadBoard: () => { void this.reloadBoard(); },
                getChapterEvents: (file, fallbackMap) => this.getChapterEvents(file, fallbackMap)
            });
        } else if (this.sortMode === 'lore') {
            await LoreBoardRenderer.render({
                ownerComponent: this.currentBoardComponent,
                app: this.app,
                plugin: this.plugin,
                container: buffer,
                files,
                currentBookPath: this.currentBookPath || '',
                matchedLoreHeadings,
                reloadBoard: () => { void this.reloadBoard(); }
            });
        } else if (this.sortMode === 'foreshadowing') {
            await ForeshadowingBoardRenderer.render({
                app: this.app,
                plugin: this.plugin,
                ownerComponent: this.currentBoardComponent,
                container: buffer,
                entries: foreshadowingEntriesList,
                foreshadowingFile: foreshadowingFileObj,
                query: this.foreshadowingFilterQuery,
                currentForeshadowingTagFilter: this.currentForeshadowingTagFilter,
                currentBookPath: this.currentBookPath || '',
                reloadBoard: () => { void this.reloadBoard(); }
            });
        } else if (this.sortMode === 'task') {
            await TaskBoardRenderer.render({
                app: this.app,
                plugin: this.plugin,
                container: buffer,
                currentBookPath: this.currentBookPath || '',
                reloadBoard: () => { void this.reloadBoard(); }
            });
        } else if (this.sortMode === 'sticky') {
			const stickyRoot = buffer.createDiv({ cls: 'wn-workbench-sticky-list-root' });
			const renderer = new StickyNoteListRenderer(this.app, this.plugin, stickyRoot, {
				mode: 'workbench',
				showToolbar: false
			});
			this.stickyNoteListRenderer = renderer;
			this.currentBoardComponent.register(() => {
				renderer.destroy();
				if (this.stickyNoteListRenderer === renderer) this.stickyNoteListRenderer = null;
			});
			renderer.render();
        } else {
            if (filteredChapterFiles.length === 0 && this.chapterFilterQuery.trim().length > 0) {
                buffer.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('corkboard.filter-no-results') });
            } else {
                this.renderOrderedBoard(buffer, filteredChapterFiles, foreshadowingMap);
            }
        }

        if (this.currentRenderId !== renderId) return;
        const tSwapStart = performance.now();
        const fragment = (window as unknown as { createFragment: () => DocumentFragment }).createFragment();
        while (buffer.firstChild) {
            fragment.appendChild(buffer.firstChild);
        }
        this.container.empty();
        this.container.toggleClass('is-timeline-mode', this.sortMode === 'timeline');
        this.container.appendChild(fragment);
        this.restorePendingFilterFocus();
        const tSwap = performance.now();
        Logger.info(`[Perf Phase] Workbench.bufferSwap: ${(tSwap - tSwapStart).toFixed(2)}ms`);
        Logger.info(`[Perf] Workbench renderBoard completed in ${(tSwap - tStart).toFixed(2)}ms (mode=${this.sortMode}, files=${files.length})`);
    }

    private renderOrderedBoard(container: HTMLElement, files: TFile[], foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>): void {
        const grid = container.createDiv('wn-corkboard-grid');
        this.renderCards(grid, files, foreshadowingMap, !this.isDescending);
    }

    private renderCards(container: HTMLElement, files: TFile[], foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>, draggable: boolean): void {
        CorkboardGridRenderer.render({
            app: this.app,
            plugin: this.plugin,
            container,
            files,
            foreshadowingMap,
            draggable,
            currentBookPath: this.currentBookPath || '',
            onSaveStateChange: (isSaving) => { this.isSavingMetadata = isSaving; }
        });
    }

    private getBookMarkdownFiles(): TFile[] {
        if (this.currentBookPath && this.currentBookPath !== '/') {
            const bookFolder = this.app.vault.getAbstractFileByPath(this.currentBookPath);
            if (bookFolder instanceof TFolder) {
                const list: TFile[] = [];
                Vault.recurseChildren(bookFolder, (child: TAbstractFile) => {
                    if (child instanceof TFile && child.extension === 'md' && this.plugin.cacheManager.isEligibleForChapterList(child)) {
                        list.push(child);
                    }
                });
                return list;
            }
        }
        return this.plugin.getTrackedMarkdownFiles();
    }

    private getChapterEvents(file: TFile, fallbackMap: Map<string, string[]>): string[] {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (fm && fm.timeline) {
            if (Array.isArray(fm.timeline)) return fm.timeline.map(String);
            if (typeof fm.timeline === 'string') return [String(fm.timeline)];
        }
        return fallbackMap.get(file.basename) || [];
    }
}
