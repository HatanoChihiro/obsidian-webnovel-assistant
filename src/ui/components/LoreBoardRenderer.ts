import { Notice, TFile, TFolder, setIcon, Component, type App } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import { t, getLocale } from '../../i18n';
import type { GraphEdge } from '../../services/RelationGraphManager';
import { ForceLayoutEngine } from '../../services/ForceLayoutEngine';
import type { LoreEntry } from '../../services/CharacterManager';
import { GraphRenderer, type GraphRenderState } from './GraphRenderer';
import { GraphInteractionController } from './GraphInteractionController';
import { LoreCardRenderer } from './LoreCardRenderer';
import { DraggableListHelper } from '../../utils/DraggableListHelper';
import { openFileAndFocus, smartLocateAndHighlight } from '../../utils/leaf';


export interface LoreBoardOptions {
    ownerComponent: Component;
    app: App;
    plugin: WebNovelAssistantPlugin;
    container: HTMLElement;
    files: TFile[];
    currentBookPath: string;
    matchedLoreHeadings?: ReadonlySet<string>;
    reloadBoard?: () => void;
}

export class LoreBoardRenderer {
    private static findFirst(f: TFolder): TFile | null {
        for (const child of f.children) {
            if (child instanceof TFile && child.extension === 'md') return child;
            if (child instanceof TFolder) {
                const res = this.findFirst(child);
                if (res) return res;
            }
        }
        return null;
    }

    static async render(options: LoreBoardOptions): Promise<void> {
        const { app, plugin, container, files, currentBookPath, matchedLoreHeadings, reloadBoard } = options;
        const bookPath = currentBookPath === '/' ? '' : currentBookPath;
        const layoutMode = plugin.settings.loreBoardLayout || 'table';
        const contentArea = container.createDiv('wn-lore-board-content');

        // --- Data Extraction ---
        await plugin.characterManager.ensureInitialized();
        const normalizedBookPath = currentBookPath === '' ? '/' : currentBookPath;
        const allCharacters = plugin.characterManager.getCharactersForBook(normalizedBookPath) || [];

        if (matchedLoreHeadings && matchedLoreHeadings.size === 0) {
            contentArea.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('corkboard.filter-no-results') });
            return;
        }

        if (layoutMode === 'graph') {
            await this.renderGraph(contentArea, app, plugin, bookPath, options.ownerComponent, matchedLoreHeadings);
            return;
        }

        if (layoutMode === 'cards') {
            await this.renderCards(contentArea, app, plugin, normalizedBookPath, allCharacters, matchedLoreHeadings, reloadBoard, options.ownerComponent);
            return;
        }

        // Table layout (Legacy/Default)
        await this.renderTable(contentArea, app, plugin, files, normalizedBookPath, allCharacters, bookPath, matchedLoreHeadings);
    }

    private static async renderCards(
        container: HTMLElement,
        app: App,
        plugin: WebNovelAssistantPlugin,
        currentBookPath: string,
        allCharacters: string[],
        matchedLoreHeadings?: ReadonlySet<string>,
        reloadBoard?: () => void,
        ownerComponent?: Component
    ) {
        if (allCharacters.length === 0) {
            container.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('corkboard.no-lore') });
            return;
        }

        const allEntries = plugin.characterManager
            .getLoreEntriesInFileOrder(currentBookPath)
            .filter(entry => !matchedLoreHeadings || matchedLoreHeadings.has(entry.heading));

        // 卡片视图下强制遵循文件本身的物理顺序，忽略 customSortOrder，确保拖拽修改文件后所见即所得
        const sortedEntries = allEntries;

        const renderedHeadings = new Set<string>();
        const fileGroups = new Map<string, { fileBasename: string, entries: LoreEntry[] }>();

        for (const entry of sortedEntries) {
            if (renderedHeadings.has(entry.heading)) continue;
            renderedHeadings.add(entry.heading);

            const path = entry.file.path;
            if (!fileGroups.has(path)) {
                fileGroups.set(path, { fileBasename: entry.file.basename, entries: [] });
            }
            fileGroups.get(path)!.entries.push(entry);
        }

        // 设定文件 tab 排序：拉丁字母开头的文件优先于汉字开头，组内按当前语言字母序（中文按拼音）与数字自然升序排列
        const locale = getLocale() === 'zh-CN' ? 'zh' : 'en';
        const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
        const isLatinStart = (name: string): boolean => /^[A-Za-z]/.test(name);
        const groups = Array.from(fileGroups.entries()).sort((a, b) => {
            const nameA = a[1].fileBasename;
            const nameB = b[1].fileBasename;
            const latinA = isLatinStart(nameA) ? 1 : 0;
            const latinB = isLatinStart(nameB) ? 1 : 0;
            if (latinA !== latinB) return latinB - latinA;
            return collator.compare(nameA, nameB);
        });

        const boardLayout = container.createDiv('wn-lore-board-layout');

        // --- 文件选项卡栏（“全部” + 各设定文件，带条数徽标） ---
        // 设计考量：仅在存在 2 个及以上设定文件时渲染文件 Tab 栏，当当前仅有一个设定文件时无分类筛选必要，隐藏 Tab 栏以保持界面简洁干净
        let activePath = plugin.settings.loreBoardActiveFile || '';
        if (!groups.some(([path]) => path === activePath)) activePath = '';

        const tabEls: { path: string; el: HTMLElement }[] = [];

        if (groups.length > 1) {
            const tabBar = boardLayout.createDiv('wn-lore-file-tabs');

            const allTab = tabBar.createDiv(`wn-lore-file-tab ${activePath === '' ? 'is-active' : ''}`);
            allTab.createSpan({ cls: 'wn-lore-file-tab-label', text: t('lore.tab-all') });
            allTab.createSpan({ cls: 'wn-lore-file-tab-count', text: String(allEntries.length) });
            allTab.title = t('lore.tab-all');
            tabEls.push({ path: '', el: allTab });

            for (const [path, group] of groups) {
                const tab = tabBar.createDiv(`wn-lore-file-tab ${activePath === path ? 'is-active' : ''}`);
                tab.createSpan({ cls: 'wn-lore-file-tab-label', text: group.fileBasename });
                tab.createSpan({ cls: 'wn-lore-file-tab-count', text: String(group.entries.length) });
                tab.title = `${group.fileBasename} (${group.entries.length})`;
                tabEls.push({ path, el: tab });
            }
        }

        // --- 各设定文件分组（DOM 常驻，仅切换显隐，保留卡片编辑与折叠状态） ---
        const panels: { path: string; panel: HTMLElement; header: HTMLElement; grid: HTMLElement; iconSpan: HTMLElement }[] = [];

        for (const [path, group] of groups) {
            const panel = boardLayout.createDiv('wn-lore-file-panel');
            const header = panel.createDiv('wn-corkboard-volume-header wn-clickable');
            const iconSpan = header.createSpan({ cls: 'wn-volume-header-icon' });
            setIcon(iconSpan, 'chevron-down');
            header.createSpan({
                text: `${group.fileBasename} ${t('lore.file-count', { count: group.entries.length.toString() }) || `(共 ${group.entries.length} 条)`}`,
                cls: 'wn-volume-header-title'
            });

            const grid = panel.createDiv('wn-lore-board-cards-grid');

            header.onclick = () => {
                const isCollapsed = grid.hasClass('is-collapsed');
                if (isCollapsed) {
                    grid.removeClass('is-collapsed');
                    grid.setCssProps({ display: 'grid' });
                    header.removeClass('is-collapsed');
                    setIcon(iconSpan, 'chevron-down');
                } else {
                    grid.addClass('is-collapsed');
                    grid.setCssProps({ display: 'none' });
                    header.addClass('is-collapsed');
                    setIcon(iconSpan, 'chevron-right');
                }
            };

            // Unique mime type to restrict cross-file dragging
            const mimeType = `application/wn-lore-${path.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;

            const boardComponent = ownerComponent ?? new Component();
            if (!ownerComponent) boardComponent.load();

            for (const entry of group.entries) {
                const cardContainer = grid.createDiv('wn-lore-card-wrapper');
                await LoreCardRenderer.buildCardDOM(cardContainer, entry, plugin, boardComponent, {
                    draggable: true,
                    dragDataMimeType: mimeType
                });
            }

            DraggableListHelper.init({
                container: grid,
                itemSelector: '.wn-lore-card',
                dragDataMimeType: mimeType,
                getDragData: (el) => el.getAttribute('data-lore-heading') || '',
                onDrop: (fromName, toName, insertAfter) => {
                    if (fromName === toName) return;

                    void (async () => {
                        const fromEntry = plugin.characterManager.getCharacterFile(currentBookPath, fromName);
                        const toEntry = plugin.characterManager.getCharacterFile(currentBookPath, toName);

                        if (fromEntry && toEntry) {
                            if (fromEntry.file.path !== toEntry.file.path) {
                                new Notice(t('error.cross-file-drag-not-supported'));
                                return;
                            }
                            const moved = await plugin.characterManager.moveLoreItem(fromEntry, toEntry, insertAfter);
                            if (moved) {
                                // 强制重新构建缓存，避免 500ms 异步防抖导致刚重绘时读取的还是旧数据
                                await plugin.characterManager.rebuildCache();
                                if (reloadBoard) reloadBoard();
                            }
                        }
                    })();
                },
            });
            
            panels.push({ path, panel, header, grid, iconSpan });
        }

        const applyView = () => {
            for (const tab of tabEls) {
                tab.el.toggleClass('is-active', tab.path === activePath);
            }
            for (const p of panels) {
                const visible = activePath === '' || p.path === activePath;
                p.panel.setCssProps({ display: visible ? '' : 'none' });
                if (visible && activePath !== '') {
                    // 单文件视图下强制展开该文件分组
                    p.grid.removeClass('is-collapsed');
                    p.grid.setCssProps({ display: 'grid' });
                    p.header.removeClass('is-collapsed');
                    setIcon(p.iconSpan, 'chevron-down');
                }
            }
        };

        // tab 点击切换（激活项持久化到插件设置）
        for (const tab of tabEls) {
            tab.el.onclick = () => {
                if (tab.path === activePath) return;
                activePath = tab.path;
                plugin.settings.loreBoardActiveFile = tab.path || undefined;
                void plugin.saveSettings();
                applyView();
            };
        }

        applyView();
    }

    private static async renderTable(
        container: HTMLElement,
        app: App,
        plugin: WebNovelAssistantPlugin,
        files: TFile[],
        currentBookPath: string,
        allCharacters: string[],
        bookPath: string,
        matchedLoreHeadings?: ReadonlySet<string>
    ) {
        const loreToChapters = new Map<string, { chapter: TFile, count: number }[]>();

        for (const key of allCharacters) {
            const entry = plugin.characterManager.getCharacterFile(currentBookPath, key);
            if (entry && entry.heading) {
                if (matchedLoreHeadings && !matchedLoreHeadings.has(entry.heading)) continue;
                if (!loreToChapters.has(entry.heading)) {
                    loreToChapters.set(entry.heading, []);
                }
            }
        }

        for (const file of files) {
            const cache = app.metadataCache.getFileCache(file);
            const loreArray = cache?.frontmatter?.lore as unknown;
            if (Array.isArray(loreArray)) {
                for (const item of loreArray) {
                    if (typeof item === 'string') {
                        const parts = item.split('×');
                        const name = parts[0].trim();
                        const canonicalName = plugin.characterManager.getCharacterFile(currentBookPath, name)?.heading ?? name;
                        if (matchedLoreHeadings && !matchedLoreHeadings.has(canonicalName)) continue;
                        const count = parts.length > 1 ? parseInt(parts[1], 10) : 1;
                        if (!loreToChapters.has(canonicalName)) loreToChapters.set(canonicalName, []);
                        loreToChapters.get(canonicalName)!.push({ chapter: file, count: isNaN(count) ? 1 : count });
                    }
                }
            }
        }

        if (loreToChapters.size === 0) {
            const emptyMsg = container.createDiv('wn-corkboard-empty-msg');
            emptyMsg.setText(t('corkboard.no-lore'));
            return;
        }

        let explicitEdges: GraphEdge[] = [];
        try {
            const loreFolderName = plugin.settings.loreFolderName || t('common.default-lore-folder-name');
            const lorePath = bookPath ? `${bookPath}/${loreFolderName}` : loreFolderName;
            const loreFolder = app.vault.getAbstractFileByPath(lorePath);
            if (loreFolder && loreFolder instanceof TFolder) {
                const sampleFile = this.findFirst(loreFolder);
                if (sampleFile) {
                    const graphManager = plugin.relationGraphManager;
                    const data = await graphManager.buildGraphData(sampleFile, { enableGlobal: true, autoLinkMentions: true });
                    explicitEdges = data.edges.filter(e => e.type === 'explicit');
                }
            }
        } catch (e) { console.error(e); }

        const sortedLores = Array.from(loreToChapters.entries()).sort((a, b) => {
            const sumA = a[1].reduce((acc, curr) => acc + curr.count, 0);
            const sumB = b[1].reduce((acc, curr) => acc + curr.count, 0);
            return sumB - sumA;
        });

        const boardLayout = container.createDiv('wn-lore-board-layout wn-lore-board-layout-table');

        for (const [loreName, chapterList] of sortedLores) {
            const groupDiv = boardLayout.createDiv('wn-lore-board-group');
            const headerRow = groupDiv.createDiv('wn-lore-board-group-header');
            const totalCount = chapterList.reduce((acc, curr) => acc + curr.count, 0);
            const leftContainer = headerRow.createSpan('wn-lore-board-group-left');
            const titleSpan = leftContainer.createSpan('wn-lore-board-group-title');
            titleSpan.setText(loreName);

            titleSpan.onclick = () => {
                if (currentBookPath !== null) {
                    const entry = plugin.characterManager.getCharacterFile(currentBookPath, loreName);
                    if (entry && entry.file) {
                        const cache = app.metadataCache.getFileCache(entry.file);
                        let fallbackLine: number | undefined;
                        if (cache?.headings) {
                            const headingInfo = cache.headings.find(h => h.heading === entry.heading);
                            if (headingInfo) fallbackLine = headingInfo.position.start.line;
                        }
                        void smartLocateAndHighlight(app, entry.file, [`## ${entry.heading}`, entry.heading, loreName], {
                            splitIfNew: true,
                            fallbackLine
                        });
                    }
                }
            };

            const relationsSpan = leftContainer.createSpan('wn-lore-board-group-relations');
            const sourceEdges = explicitEdges.filter(e => e.source === loreName);
            if (sourceEdges.length > 0) {
                const groupedByLabel = new Map<string, string[]>();
                for (const edge of sourceEdges) {
                    if (!groupedByLabel.has(edge.label)) groupedByLabel.set(edge.label, []);
                    groupedByLabel.get(edge.label)!.push(edge.target);
                }
                for (const [label, targets] of groupedByLabel) {
                    const item = relationsSpan.createDiv('wn-lore-board-relation-item');
                    item.createSpan({ text: label, cls: 'wn-lore-board-relation-badge' });
                    item.createSpan({ text: targets.join('、'), cls: 'wn-lore-board-relation-targets' });
                }
            }

            const countSpan = headerRow.createSpan('wn-lore-board-group-count');
            countSpan.setText(t('corkboard.lore-total-count', { count: totalCount.toString() }) || `共出现 ${totalCount} 次`);

            const cardsContainer = groupDiv.createDiv('wn-lore-board-cards');
            chapterList.sort((a, b) => b.count - a.count);

            for (const item of chapterList) {
                const miniCard = cardsContainer.createDiv('wn-lore-board-mini-card');
                miniCard.onclick = () => {
                    void (async () => {
                        let targetLeaf = app.workspace.getLeavesOfType('markdown').find(l => (l.view as unknown as { file?: { path: string } }).file?.path === item.chapter.path);
                        if (!targetLeaf) targetLeaf = app.workspace.getLeavesOfType('markdown')[0];
                        if (!targetLeaf) targetLeaf = app.workspace.getLeaf('split', 'vertical');
                        await openFileAndFocus(app, targetLeaf, item.chapter);
                    })();
                };
                miniCard.createDiv({ text: item.chapter.basename, cls: 'wn-lore-board-mini-card-title' });
                miniCard.createDiv({ text: `×${item.count}`, cls: 'wn-lore-board-mini-card-count' });
            }
        }
    }

    private static async renderGraph(
        container: HTMLElement,
        app: App,
        plugin: WebNovelAssistantPlugin,
        bookPath: string,
        ownerComponent: Component,
        matchedLoreHeadings?: ReadonlySet<string>
    ) {
        container.empty();
        container.addClass('wn-lore-graph-container');

        const loreFolderName = plugin.settings.loreFolderName || t('common.default-lore-folder-name');
        const lorePath = bookPath ? `${bookPath}/${loreFolderName}` : loreFolderName;
        const loreFolder = app.vault.getAbstractFileByPath(lorePath);

        if (!loreFolder || !(loreFolder instanceof TFolder)) {
            container.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('corkboard.no-lore') });
            return;
        }

        const sampleFile = this.findFirst(loreFolder);
        if (!sampleFile) {
            container.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('corkboard.no-lore') });
            return;
        }

        const graphManager = plugin.relationGraphManager;
        const data = await graphManager.buildGraphData(sampleFile, { enableGlobal: true, autoLinkMentions: true });

        if (data.nodes.length === 0) {
            container.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('corkboard.no-lore') });
            return;
        }

        const graphWrapper = container.createDiv('wn-lore-graph-wrapper');
        const canvas = graphWrapper.createEl('canvas', { cls: 'wn-lore-graph-canvas' });

        // 获取并计算 Canvas 实际物理与设备像素尺寸
        const rect = graphWrapper.getBoundingClientRect();
        const initialWidth = rect.width || 600;
        const initialHeight = rect.height || 400;
        const DPR = window.devicePixelRatio || 1;
        canvas.width = initialWidth * DPR;
        canvas.height = initialHeight * DPR;
        // 不在 canvas 上设置固定 css width/height 内联样式，由 CSS .wn-lore-graph-canvas (width: 100%; height: 100%) 自适应填充容器

        // 像 RelationGraphView 一样，在力导向引擎启动前将节点在大圆上均匀分布，避免中心重叠或初始暴弹
        const cx = initialWidth / 2;
        const cy = initialHeight / 2;
        const radius = Math.min(cx, cy) * 0.8;

        data.nodes.forEach((node, i) => {
            const angle = (i / data.nodes.length) * Math.PI * 2;
            node.x = cx + radius * Math.cos(angle);
            node.y = cy + radius * Math.sin(angle);
            node.vx = 0;
            node.vy = 0;
            node.pinned = false;
        });

        const engine = new ForceLayoutEngine(data.nodes, data.edges, initialWidth, initialHeight);

        let initialScale = 1.0;
        const nodeCount = data.nodes.length;
        if (nodeCount <= 6) {
            initialScale = 2.2;
        } else if (nodeCount <= 12) {
            initialScale = 1.6;
        } else if (nodeCount <= 25) {
            initialScale = 1.2;
        }

        const state: GraphRenderState = {
            graphData: data,
            scale: initialScale,
            panX: 0,
            panY: 0,
            selectedNode: null,
            hoveredNode: null,
            isLocalMode: false,
            localFocusNode: null,
            edgeDrawModeMap: new Map(),
            edgeOffsetMap: new Map(),
            combinedLabelMap: new Map(),
            filterMatchNodeIds: matchedLoreHeadings
        };

        GraphRenderer.buildEdgeOffsets(data, state);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const colors = GraphRenderer.getThemeColors(activeDocument.body);

        let animationFrameId = 0;
        let currentAnimationToken = 0;
        let needsRender = true;

        const requestRender = () => {
            needsRender = true;
            if (!animationFrameId && engine) {
                startAnimationLoop(false);
            }
        };

        const startAnimationLoop = (isFirstLoad: boolean = false) => {
            if (animationFrameId) {
                window.cancelAnimationFrame(animationFrameId);
                animationFrameId = 0;
            }

            const token = ++currentAnimationToken;

            if (isFirstLoad) {
                state.panX = 0;
                state.panY = 0;
                if (nodeCount <= 6) {
                    state.scale = 2.2;
                } else if (nodeCount <= 12) {
                    state.scale = 1.6;
                } else if (nodeCount <= 25) {
                    state.scale = 1.2;
                } else {
                    state.scale = 1.0;
                }
            }

            const loop = () => {
                if (currentAnimationToken !== token) return;
                if (!engine || !canvas) return;

                const ticksPerFrame = 3;
                let physicsRunning = false;
                for (let i = 0; i < ticksPerFrame; i++) {
                    const running = engine.tick();
                    if (running) physicsRunning = true;
                }

                // 将 D3 引擎中的坐标同步回 GraphNode 供 GraphRenderer 绘制
                for (let i = 0; i < engine.nodes.length && i < data.nodes.length; i++) {
                    data.nodes[i].x = engine.nodes[i].x;
                    data.nodes[i].y = engine.nodes[i].y;
                }

                if (physicsRunning || needsRender) {
                    const w = canvas.width / GraphRenderer.DPR;
                    const h = canvas.height / GraphRenderer.DPR;
                    GraphRenderer.render(ctx, w, h, data, state, colors);
                    needsRender = false;
                }

                if (physicsRunning) {
                    animationFrameId = window.requestAnimationFrame(loop);
                } else {
                    animationFrameId = 0;
                }
            };

            animationFrameId = window.requestAnimationFrame(loop);
        };

        let isFirstValidResize = true;

        const resizeCanvas = () => {
            const rect = graphWrapper.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const DPR = window.devicePixelRatio || 1;
            canvas.width = rect.width * DPR;
            canvas.height = rect.height * DPR;

            if (isFirstValidResize) {
                isFirstValidResize = false;
                // 如果初次渲染发生在离屏 buffer 中 (600x400)，DOM 挂载后根据真实容器尺寸平移节点至真实居中点
                const dx = (rect.width - initialWidth) / 2;
                const dy = (rect.height - initialHeight) / 2;
                if (dx !== 0 || dy !== 0) {
                    data.nodes.forEach(node => {
                        node.x += dx;
                        node.y += dy;
                    });
                }
            }

            engine.resize(rect.width, rect.height);
            if (engine.isConverged) {
                engine.reset();
                startAnimationLoop(false);
            }
            requestRender();
        };

        const ro = new ResizeObserver(() => {
            resizeCanvas();
        });
        ro.observe(graphWrapper);

        // 启动初次布局动画
        startAnimationLoop(true);

        const controller = new GraphInteractionController(canvas, state, {
            requestRender: () => requestRender(),
            onNodeDoubleClick: (node) => {
                // 高亮选中双击的节点
                state.selectedNode = node;
                requestRender();

                // 双击节点：打开对应设定文档并精准定位至标题行
                const entry = plugin.characterManager.getCharacterFile(bookPath, node.id);
                if (entry) {
                    const cache = app.metadataCache.getFileCache(entry.file);
                    let fallbackLine: number | undefined;
                    if (cache?.headings) {
                        for (const h of cache.headings) {
                            const rawHeading = h.heading.replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '');
                            if (rawHeading === entry.heading && h.level === 2) {
                                fallbackLine = h.position.start.line;
                                break;
                            }
                        }
                    }
                    void smartLocateAndHighlight(app, entry.file, [`## ${entry.heading}`, entry.heading, node.id], {
                        splitIfNew: true,
                        fallbackLine
                    });
                } else {
                    new Notice(t('relation.character-not-found', { id: node.id }) || `未找到设定 ${node.id} 的设定文件`);
                }
            },
            onBackgroundDoubleClick: () => {
                state.isLocalMode = false;
                state.localFocusNode = null;
                state.selectedNode = null;
                requestRender();
            },
            onNodeHover: (node) => {
                state.hoveredNode = node;
            },
            onNodeDragStart: (node) => {
                const ln = engine.nodes.find(n => n.id === node.id);
                if (ln) {
                    ln.pinned = true;
                    ln.fx = node.x;
                    ln.fy = node.y;
                }
                node.pinned = true;
                // 注意：单击节点选中时不触发 engine.reheat()，防止图谱因为节点选中而重新打乱跳动
            },
            onNodeDrag: (node, x, y) => {
                const ln = engine.nodes.find(n => n.id === node.id);
                if (ln) {
                    ln.fx = x;
                    ln.fy = y;
                    ln.x = x;
                    ln.y = y;
                }
                node.x = x;
                node.y = y;

                if (engine.isConverged) {
                    engine.reheat();
                    startAnimationLoop(false);
                } else {
                    engine.reheat();
                }
                requestRender();
            },
            onNodeDragEnd: (node) => {
                const ln = engine.nodes.find(n => n.id === node.id);
                if (ln) {
                    ln.pinned = true;
                    ln.fx = node.x;
                    ln.fy = node.y;
                }
                node.pinned = true;
            }
        });

        controller.updateLayout(data);
        controller.bindEvents();

        ownerComponent.register(() => {
            if (animationFrameId) {
                window.cancelAnimationFrame(animationFrameId);
                animationFrameId = 0;
            }
            controller.unbindEvents();
            ro.disconnect();
        });

        
    }
}
