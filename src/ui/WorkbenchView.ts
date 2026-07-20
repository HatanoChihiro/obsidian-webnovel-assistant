import { TFile, type WorkspaceLeaf, ItemView, Notice, Menu, Modal, Setting } from 'obsidian';
import type { App, ViewStateResult } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ChapterSorter } from '../services/ChapterSorter';
import { getCurrentBookContext } from '../utils/path';
import { t } from '../i18n';
import { getNovelStatusText, getNovelInfoLabel } from '../i18n/data-keys';
import { CorkboardGridRenderer } from './components/CorkboardGridRenderer';
import { TimelineBoardRenderer } from './components/TimelineBoardRenderer';
import { LoreBoardRenderer } from './components/LoreBoardRenderer';
import { AddLoreModal } from './AddLoreModal';
import { DraggableListHelper } from '../utils/DraggableListHelper';
import { TouchDragPolyfill } from '../utils/TouchDragPolyfill';

class NewChapterModal extends Modal {
    constructor(
        app: App, 
        private defaultPrefix: string, 
        private enableTemplate: boolean,
        private templatePath: string,
        private onSubmit: (title: string, templateContent: string) => void
    ) {
        super(app);
    }
    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setHeading().setName(t('corkboard.new-chapter'));
        const inputEl = contentEl.createEl('input', { type: 'text' });
        inputEl.setCssStyles({ width: '100%', marginBottom: '1em' });
        inputEl.value = this.defaultPrefix;

        const btn = contentEl.createEl('button', { text: t('common.confirm') });
        btn.onclick = async () => {
            if (inputEl.value.trim()) {
                let templateContent = '';
                if (this.enableTemplate && this.templatePath) {
                    try {
                        const file = this.app.vault.getAbstractFileByPath(this.templatePath);
                        if (file instanceof TFile) {
                            templateContent = await this.app.vault.read(file);
                        }
                    } catch (e) {
                        console.error(t('workbench.error-read-template', { error: String(e) }) || '无法读取模板文件:', e);
                    }
                }
                this.onSubmit(inputEl.value.trim(), templateContent);
                this.close();
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
    private plugin: WebNovelAssistantPlugin;
    public currentBookPath: string | null = null;
    private isSavingMetadata: boolean = false;
    private sortMode: 'default' | 'timeline' | 'lore' = 'default';
    private collapsedGroups: Set<string> = new Set();
    private container!: HTMLElement;
    private currentTimelineFilter: string = 'all';
    private currentRenderId: number = 0;
    private draggableListCleanup: (() => void) | null = null;
    private touchPolyfillCleanup: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
        super(leaf);
        this.plugin = plugin;

        // 监听 timeline 筛选事件
        this.registerEvent(this.app.workspace.on('timeline-filter-changed', (filter: string) => {
            this.currentTimelineFilter = filter;
            void this.reloadBoard();
        }));

        // 监听文件或元数据变化以刷新视图
        this.registerEvent(this.app.vault.on('rename', () => {
            if (this.isSavingMetadata) return;
            void this.reloadBoard();
        }));
        this.registerEvent(this.app.vault.on('delete', () => {
            if (this.isSavingMetadata) return;
            void this.reloadBoard();
        }));
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (this.isSavingMetadata) return;
            if (file instanceof TFile && !this.plugin.cacheManager.isFileInWorkspace(file)) return;
            this.plugin.adaptiveDebounceManager.debounceFixed('corkboard-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (this.isSavingMetadata) return;
            if (file instanceof TFile && !this.plugin.cacheManager.isFileInWorkspace(file)) return;
            this.plugin.adaptiveDebounceManager.debounceFixed('corkboard-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (!leaf || leaf.view.getViewType() !== 'markdown') return;
            let newBookPath = getCurrentBookContext(this.app, this.plugin);
            if (newBookPath === '') newBookPath = '/';
            if (newBookPath !== null) {
                if (newBookPath !== undefined && newBookPath !== this.currentBookPath) {
                    const hasValidBook = this.currentBookPath && this.currentBookPath !== '/' && this.currentBookPath !== '';
                    if (hasValidBook) {
                        const workspaceFolders = this.plugin.settings.workspaceFolders || [];
                        const isNonNovelPath = newBookPath === '/' || newBookPath === ''
                            || workspaceFolders.includes(newBookPath);
                        if (isNonNovelPath) {
                            return;
                        }
                    }
                    this.currentBookPath = newBookPath;
                    void this.reloadBoard();
                }
            }
        }));
        this.registerEvent(
            this.app.workspace.on('webnovel-workbench-lore-updated', () => {
                void this.reloadBoard();
            })
        );
    }



    public setBookPath(path: string) {
        if (this.currentBookPath !== path) {
            this.currentBookPath = path;
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

        const files = this.plugin.getTrackedMarkdownFiles().filter(file => {
            if (this.plugin.settings.enableStrictChapterMode 
                && !ChapterSorter.isChapterFile(file.name)
                && !this.plugin.isFileInStrictChapterException(file)) {
                return false;
            }
            const lorePath = this.plugin.settings.loreFolderName || t('common.default-lore-folder-name');
            if (file.path.includes(`/${lorePath}/`) || file.path.startsWith(`${lorePath}/`)) {
                return false;
            }
            if (this.currentBookPath === '/') return true;
            return file.path.startsWith(this.currentBookPath + '/');
        });
        
        files.sort((a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, this.plugin.settings.customSortOrder || {}));

        const fromIdx = files.findIndex(f => f.path === fromPath);
        const toIdx = files.findIndex(f => f.path === toPath);
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

        const originalSlots = files.slice(startIdx, endIdx + 1).map(f => ({
            file: f,
            ext: ChapterSorter.extractChapterNumber(f.name)
        }));

        const isMainSequenceDecimal = originalSlots.every(s => s.ext?.isDecimal);

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
                
                for (const op of tempOps) {
                    await this.app.fileManager.renameFile(op.file, op.tempPath);
                }
                
                // Step 2: Rename from temporary paths to final paths
                for (const op of tempOps) {
                    await this.app.fileManager.renameFile(op.file, op.newPath);
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
                new Notice(t('workbench.rename-failed', { error: String(e) }) || ('重命名失败: ' + e));
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
        return t('view.corkboard');
    }

    getIcon(): string {
        return 'laptop';
    }

    async onOpen(): Promise<void> {
        this.sortMode = this.plugin.settings.corkboardSortMode || 'default';
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
            canDrag: () => this.sortMode === 'default',
            onDrop: (fromPath, toPath, insertAfter) => {
                if (this.sortMode !== 'default') return;
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

    public async reloadBoard(): Promise<void> {
        if (!this.container) return;

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
            header.createDiv({ text: t('view.corkboard'), cls: 'wn-corkboard-title' });
            header.createEl('p', {
                text: t('corkboard.please-open-file'),
                cls: 'wn-corkboard-hint'
            });
        }

        if (this.sortMode === 'timeline') {
            const mainCol = this.container.querySelector('.wn-timeline-waterfall-main') as HTMLElement;
            if (mainCol) mainCol.scrollTop = timelineScrollTop;
            const sideCol = this.container.querySelector('.wn-timeline-waterfall-sidebar') as HTMLElement;
            if (sideCol) sideCol.scrollTop = sidebarScrollTop;
        } else {
            this.container.scrollTop = defaultScrollTop;
        }
    }

    private async renderBoard(): Promise<void> {
        const renderId = ++this.currentRenderId;
        const buffer = createDiv();

        const header = buffer.createDiv('wn-corkboard-header');
        header.createDiv({ text: t('view.corkboard'), cls: 'wn-corkboard-title' });

        if (!this.currentBookPath) {
            header.createEl('p', {
                text: t('corkboard.please-open-file'),
                cls: 'wn-corkboard-hint'
            });
            if (this.currentRenderId !== renderId) return;
            this.container.empty();
            while (buffer.firstChild) this.container.appendChild(buffer.firstChild);
            return;
        }

        let displayBookName = t('corkboard.vault-root');
        if (this.currentBookPath && this.currentBookPath !== '/') {
            const parts = this.currentBookPath.split('/');
            displayBookName = parts[parts.length - 1];
        }

        const hintEl = header.createEl('p', { cls: 'wn-corkboard-hint' });
        hintEl.appendText(t('corkboard.current-novel', { name: displayBookName }) + ' ');
        const switchSpan = hintEl.createSpan({ text: t('corkboard.click-to-switch') });
        switchSpan.setCssStyles({ cursor: 'pointer', color: 'var(--text-muted)' });

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
        const files = this.plugin.getTrackedMarkdownFiles().filter(file => {
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
            if (this.currentBookPath === '/') return true;
            return file.path.startsWith(this.currentBookPath + '/');
        });

        if (this.plugin.settings.enableSmartChapterSort) {
            const customOrder = this.plugin.settings.customSortOrder || {};
            files.sort((a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, customOrder));
        } else {
            // 否则按文件名简单排序
            files.sort((a, b) => a.basename.localeCompare(b.basename));
        }

        // 解析伏笔（获取待回收列表）
        let foreshadowings: ParsedForeshadowingEntry[] = [];
        if (this.currentBookPath && this.plugin.foreshadowingManager) {
            const fmFolder = this.currentBookPath === '/' ? '' : this.currentBookPath;
            const fFile = this.plugin.foreshadowingManager.findForeshadowingFile(fmFolder);
            if (fFile) {
                const content = await this.app.vault.cachedRead(fFile);
                foreshadowings = this.plugin.foreshadowingManager.parseEntries(content);
            }
        }

        const foreshadowingMap = new Map<string, ParsedForeshadowingEntry[]>();
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
            } else if (entry.status === ForeshadowingStatus.Recovered) {
                targets.push(...sources);
                const recFiles = entry.recoveryFiles ? [...entry.recoveryFiles] : (entry.recoveryFile ? [entry.recoveryFile] : []);
                targets.push(...recFiles);
            }

            for (const target of targets) {
                if (!target) continue;
                const cleanTarget = target.toLowerCase().replace(/\s+/g, '');
                for (const file of files) {
                    const cleanBase = file.basename.toLowerCase().replace(/\s+/g, '');
                    // 模糊匹配
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

        // 头部按钮容器（样式由 .wn-corkboard-header-buttons 管理）
        const buttonsContainer = header.createDiv('wn-corkboard-header-buttons');

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
        } else {
            // 右上角：新增章节按钮
            const newChapterBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-new-chapter-btn' });
            newChapterBtn.textContent = t('corkboard.new-chapter');
            newChapterBtn.onclick = () => {
                let defaultPrefix = '01 ';
                if (files.length > 0) {
                    const siblingNames = files.map(f => f.basename);
                    for (let i = files.length - 1; i >= 0; i--) {
                        const nextName = ChapterSorter.getNextChapterName(files[i].basename, siblingNames);
                        if (nextName) {
                            defaultPrefix = nextName.replace(/\.md$/, '').trimEnd() + ' ';
                            break;
                        }
                    }
                }

                new NewChapterModal(this.app, defaultPrefix, this.plugin.settings.enableChapterTemplate, this.plugin.settings.chapterTemplatePath, (title, templateContent) => {
                    const folder = this.currentBookPath === '/' ? '' : (this.currentBookPath + '/');
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
        const toggleGroup = buffer.createDiv('wn-corkboard-toggle-group');

        const btnDefault = toggleGroup.createEl('span', {
            text: t('corkboard.sort-default'),
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'default' ? 'active' : ''}`
        });

        const btnTimeline = toggleGroup.createEl('span', {
            text: t('corkboard.sort-timeline'),
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'timeline' ? 'active' : ''}`
        });

        const btnLore = toggleGroup.createEl('span', {
            text: t('corkboard.sort-lore'),
            cls: `wn-corkboard-toggle-btn ${this.sortMode === 'lore' ? 'active' : ''}`
        });

        btnDefault.onclick = async () => {
            if (this.sortMode === 'default') return;
            this.sortMode = 'default';
            this.plugin.settings.corkboardSortMode = 'default';
            await this.plugin.saveSettings();
            void this.reloadBoard();
        };

        btnTimeline.onclick = async () => {
            if (this.sortMode === 'timeline') return;
            this.sortMode = 'timeline';
            this.plugin.settings.corkboardSortMode = 'timeline';
            await this.plugin.saveSettings();
            void this.reloadBoard();
        };

        btnLore.onclick = async () => {
            if (this.sortMode === 'lore') return;
            this.sortMode = 'lore';
            this.plugin.settings.corkboardSortMode = 'lore'; // Need to update Settings interface in types
            await this.plugin.saveSettings();
            void this.reloadBoard();
        };

        if (this.sortMode === 'timeline') {
            await TimelineBoardRenderer.render({
                app: this.app,
                plugin: this.plugin,
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
                ownerComponent: this,
                app: this.app,
                plugin: this.plugin,
                container: buffer,
                files,
                currentBookPath: this.currentBookPath || '',
                reloadBoard: () => { void this.reloadBoard(); }
            });
        } else {
            this.renderOrderedBoard(buffer, files, foreshadowingMap);
        }

        if (this.currentRenderId !== renderId) return;
        this.container.empty();
        while (buffer.firstChild) {
            this.container.appendChild(buffer.firstChild);
        }
    }

    private renderOrderedBoard(container: HTMLElement, files: TFile[], foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>): void {
        const grid = container.createDiv('wn-corkboard-grid');
        this.renderCards(grid, files, foreshadowingMap, true);
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
