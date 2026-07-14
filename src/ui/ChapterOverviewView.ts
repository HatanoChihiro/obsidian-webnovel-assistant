import { TFile, type WorkspaceLeaf, ItemView, TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ChapterSorter } from '../services/ChapterSorter';
import { t } from '../i18n';
import { getCurrentBookContext } from '../utils/path';
import { ChapterCard } from './components/ChapterCard';

export const CORKBOARD_VIEW_TYPE = 'webnovel-corkboard';

export class ChapterOverviewView extends ItemView {
    private plugin: WebNovelAssistantPlugin;
    private currentBookPath: string | null = null;
    private isSavingMetadata: boolean = false;
    private container!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Listen to events for refresh
        this.registerEvent(this.app.vault.on('rename', () => {
            if (this.isSavingMetadata) return;
            void this.reloadBoard();
        }));
        this.registerEvent(this.app.vault.on('delete', () => {
            if (this.isSavingMetadata) return;
            void this.reloadBoard();
        }));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (this.isSavingMetadata) return;
            if (file instanceof TFile && !this.plugin.isFileInWorkspace(file)) return;
            this.plugin.adaptiveDebounceManager.debounceFixed('corkboard-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));
        
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (!leaf || leaf.view.getViewType() !== 'markdown') return;
            const newBookPath = getCurrentBookContext(this.app, this.plugin);
            if (newBookPath !== undefined && newBookPath !== this.currentBookPath) {
                const hasValidBook = this.currentBookPath && this.currentBookPath !== '/' && this.currentBookPath !== '';
                if (hasValidBook) {
                    const workspaceFolders = this.plugin.settings.workspaceFolders || [];
                    const isNonNovelPath = newBookPath === '/' || newBookPath === ''
                        || newBookPath === null || workspaceFolders.includes(newBookPath ?? '');
                    if (isNonNovelPath) {
                        return;
                    }
                }
                this.currentBookPath = newBookPath;
                void this.reloadBoard();
            }
        }));

        this.registerEvent(this.app.workspace.on('webnovel-workbench-book-changed', (bookPath: string) => {
            const folderStr = bookPath === '/' ? '/' : bookPath;
            if (folderStr && folderStr !== this.currentBookPath) {
                this.currentBookPath = folderStr;
                void this.reloadBoard();
            }
        }));
    }

    public setBookPath(path: string) {
        if (this.currentBookPath !== path) {
            this.currentBookPath = path;
            void this.reloadBoard();
        }
    }

    getViewType(): string {
        return CORKBOARD_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t('view.chapter-overview') || '章节一览';
    }

    getIcon(): string {
        return 'library';
    }

    async onOpen() {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('wn-corkboard-container');
        this.currentBookPath = getCurrentBookContext(this.app, this.plugin) || null;
        void this.reloadBoard();
    }

    async onClose() {
        this.contentEl.empty();
    }

    public async reloadBoard(): Promise<void> {
        if (!this.container) return;
        
        let scrollTop = 0;
        const grid = this.container.querySelector('.wn-corkboard-grid');
        if (grid) scrollTop = grid.scrollTop;

        this.container.empty();

        if (!this.currentBookPath) {
            const emptyEl = this.container.createDiv('wn-corkboard-empty');
            emptyEl.setText(t('corkboard.no-book-open') || '请先打开属于一部小说的文档');
            return;
        }

        const folderPath = this.currentBookPath === '/' ? '' : this.currentBookPath;
        const folder = this.app.vault.getAbstractFileByPath(folderPath || '/');
        
        if (!(folder instanceof TFolder)) {
            const emptyEl = this.container.createDiv('wn-corkboard-empty');
            emptyEl.setText(t('corkboard.folder-not-found') || '找不到当前书籍文件夹');
            return;
        }

        const files = this.plugin.getTrackedMarkdownFiles().filter(file => {
            // 只有在开启严格章节模式时，才强制要求必须是章节命名格式
            if (this.plugin.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
                return false;
            }
            // 排除设定文件夹
            const lorePath = this.plugin.settings.loreFolderName || t('common.default-lore-folder-name') || '设定';
            if (file.path.includes(`/${lorePath}/`) || file.path.startsWith(`${lorePath}/`)) {
                return false;
            }
            if (this.currentBookPath === '/') return true;
            return file.path.startsWith(this.currentBookPath + '/');
        });
        
        if (this.plugin.settings.enableSmartChapterSort) {
            const customOrder = this.plugin.settings.customSortOrder || {};
            files.sort((a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, customOrder));
        } else {
            files.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
        }

        const newGrid = this.container.createDiv('wn-corkboard-grid');
        
        // 解析伏笔
        const fmFolder = this.currentBookPath === '/' ? '' : (this.currentBookPath || '');
        const fFile = this.plugin.foreshadowingManager?.findForeshadowingFile(fmFolder);
        const foreshadowingMap = new Map<string, ParsedForeshadowingEntry[]>();
        
        if (fFile) {
            const content = await this.app.vault.cachedRead(fFile);
            const entries = this.plugin.foreshadowingManager!.parseEntries(content);
            for (const entry of entries) {
                let targets: string[] = [];
                if (entry.status === ForeshadowingStatus.Pending) {
                    if (entry.sourceFile) targets.push(entry.sourceFile);
                } else if (entry.status === ForeshadowingStatus.Recovered) {
                    targets = entry.recoveryFiles ? [...entry.recoveryFiles] : (entry.recoveryFile ? [entry.recoveryFile] : []);
                }
                for (const target of targets) {
                    if (!target) continue;
                    const cleanTarget = target.toLowerCase().replace(/\s+/g, '');
                    for (const file of files) {
                        const cleanBase = file.basename.toLowerCase().replace(/\s+/g, '');
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

        for(const file of files) {
            ChapterCard.render(newGrid, file, this.app, this.plugin, foreshadowingMap.get(file.basename) || [], {
                draggable: false,
                onSaveStateChange: (isSaving) => { this.isSavingMetadata = isSaving; },
                currentBookPath: this.currentBookPath || ''
            });
        }
        
        window.requestAnimationFrame(() => {
            if (newGrid && scrollTop > 0) newGrid.scrollTop = scrollTop;
        });
    }


}
