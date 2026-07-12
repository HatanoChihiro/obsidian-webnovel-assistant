import { TFile, type WorkspaceLeaf, ItemView, Notice, Menu, Modal, Setting } from 'obsidian';
import type { App, ViewStateResult } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ChapterSorter } from '../services/ChapterSorter';
import { findBookRoot } from '../utils/path';
import { t } from '../i18n';
import { getNovelStatusText, getNovelInfoLabel } from '../i18n/data-keys';
import { CorkboardGridRenderer } from './components/CorkboardGridRenderer';
import { TimelineBoardRenderer } from './components/TimelineBoardRenderer';
import { LoreBoardRenderer } from './components/LoreBoardRenderer';
import { AddLoreModal } from './AddLoreModal';

class NewChapterModal extends Modal {
    constructor(app: App, private defaultPrefix: string, private onSubmit: (title: string) => void) {
        super(app);
    }
    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setHeading().setName(t('corkboard.new-chapter') || '新增章节');
        const inputEl = contentEl.createEl('input', { type: 'text' });
        inputEl.setCssStyles({ width: '100%', marginBottom: '1em' });
        inputEl.value = this.defaultPrefix;
        const btn = contentEl.createEl('button', { text: t('common.confirm') || '确认' });
        btn.onclick = () => {
            if (inputEl.value.trim()) {
                this.onSubmit(inputEl.value.trim());
                this.close();
            }
        };
        inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btn.click();
        });
        setTimeout(() => {
            inputEl.focus();
            inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
        }, 50);
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

    constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
        super(leaf);
        this.plugin = plugin;

        // 监听 timeline 筛选事件
        this.registerEvent(this.app.workspace.on('webnovel-timeline-filter-changed', (filter: string) => {
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
            if (file instanceof TFile && !this.plugin.isFileInWorkspace(file)) return;
            this.plugin.adaptiveDebounceManager.debounceFixed('corkboard-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (this.isSavingMetadata) return;
            if (file instanceof TFile && !this.plugin.isFileInWorkspace(file)) return;
            this.plugin.adaptiveDebounceManager.debounceFixed('corkboard-refresh', () => {
                void this.reloadBoard();
            }, 1000);
        }));
        // 监听活动叶子节点变化，以便自动切换小说
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (!leaf || leaf.view.getViewType() !== 'markdown') return;
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const newBookPath = findBookRoot(this.app, this.plugin, activeFile, true);
                if (newBookPath !== undefined && newBookPath !== this.currentBookPath) {
                    // 如果工作台已锁定在某个具体作品上，则只有打开属于「另一部作品」的文件时才切换。
                    // 以下情况视为"非作品文件"，一律忽略：
                    //   1. newBookPath 为 '' 或 '/'（Vault 根目录或严格模式未匹配）
                    //   2. newBookPath 等于某个工作区文件夹本身（文件在工作区顶层，如创作主页）
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
    }

    public setBookPath(path: string) {
        if (this.currentBookPath !== path) {
            this.currentBookPath = path;
            void this.reloadBoard();
            this.app.workspace.trigger('webnovel-workbench-book-changed', path);
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

        // 确定当前所处的作品目录
        const activeFile = this.app.workspace.getActiveFile();
        if (!this.currentBookPath) {
            this.currentBookPath = this.plugin.characterManager.getBookPathForFile(activeFile);
        }
        if (this.currentBookPath) {
            this.app.workspace.trigger('webnovel-workbench-book-changed', this.currentBookPath);
        }

        await this.renderBoard();
    }

    async onClose(): Promise<void> {
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
        const switchSpan = hintEl.createSpan({ text: t('corkboard.click-to-switch') || '(点击切换)' });
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
            if (this.plugin.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
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
            let targets: string[] = [];
            if (entry.status === 'pending' || entry.status === 'unresolved') {
                if (entry.sourceFile) {
                    targets.push(entry.sourceFile);
                }
            } else if (entry.status === 'recovered') {
                targets = entry.recoveryFiles ? [...entry.recoveryFiles] : (entry.recoveryFile ? [entry.recoveryFile] : []);
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
                const statuses = ['ongoing', 'stockpiling', 'paused', 'completed'];
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
            newLoreBtn.textContent = t('modal.add-new-lore') || '添加新设定';
            newLoreBtn.onclick = () => {
                new AddLoreModal(this.app, this.plugin, '', this.currentBookPath || '').open();
            };
        } else {
            // 右上角：新增章节按钮
            const newChapterBtn = buttonsContainer.createDiv({ cls: 'wn-corkboard-new-chapter-btn' });
            newChapterBtn.textContent = t('corkboard.new-chapter') || '新增章节';
            newChapterBtn.onclick = () => {
                let defaultPrefix = '01 ';
                if (files.length > 0) {
                    const siblingNames = files.map(f => f.basename);
                    for (let i = files.length - 1; i >= 0; i--) {
                        const nextName = ChapterSorter.getNextChapterName(files[i].basename, siblingNames);
                        if (nextName) {
                            defaultPrefix = nextName.replace(/\.md$/, '') + ' ';
                            break;
                        }
                    }
                }

                new NewChapterModal(this.app, defaultPrefix, (title) => {
                    const folder = this.currentBookPath === '/' ? '' : (this.currentBookPath + '/');
                    const newPath = folder + title + '.md';
                    this.isSavingMetadata = true;
                    this.app.vault.create(newPath, '').then(_file => {
                        new Notice((t('corkboard.new-chapter-success') || '创建章节: ') + title);
                        // 留在工作台，仅刷新面?
                        void this.reloadBoard();
                        setTimeout(() => {
                            this.isSavingMetadata = false;
                        }, 1500); // 避免 metadataCache changed 事件引发的二次刷新跳?
                    }).catch(e => {
                        this.isSavingMetadata = false;
                        console.error(e);
                        new Notice(t('corkboard.new-chapter-failed') || '章节创建失败');
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

toggleGroup.createSpan({ text: '|', cls: 'wn-corkboard-toggle-separator' });

const btnTimeline = toggleGroup.createEl('span', {
    text: t('corkboard.sort-timeline'),
    cls: `wn-corkboard-toggle-btn ${this.sortMode === 'timeline' ? 'active' : ''}`
});

toggleGroup.createSpan({ text: '|', cls: 'wn-corkboard-toggle-separator' });

const btnLore = toggleGroup.createEl('span', {
    text: t('corkboard.sort-lore') || '设定',
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
				app: this.app,
				plugin: this.plugin,
				container: buffer,
				files,
				currentBookPath: this.currentBookPath || ''
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
		this.renderCards(grid, files, foreshadowingMap, false);
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
