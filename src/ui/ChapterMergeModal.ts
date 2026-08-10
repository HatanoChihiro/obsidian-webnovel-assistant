import type { App, TFolder } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ChapterMergeItem } from '../services/ChapterMergeManager';

/**
 * 选中文本右键修改弹窗 (SelectionRevisionModal)
 */
class SelectionRevisionModal extends Modal {
	constructor(
		app: App,
		private originalText: string,
		private onSubmit: (newText: string, noteText: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-merge-selection-modal');

		const header = contentEl.createDiv({ cls: 'wn-merge-modal-header' });
		header.createDiv({ text: t('merge.selection-title'), cls: 'wn-merge-modal-title' });

		const body = contentEl.createDiv({ cls: 'wn-merge-selection-body' });

		// 1. 原文展示
		const origBox = body.createDiv({ cls: 'wn-merge-rev-orig-text' });
		origBox.createSpan({ text: t('merge.revision-original', { text: this.originalText }) });

		// 2. 修改后新文本
		body.createEl('label', { text: t('merge.revision-new-label'), cls: 'wn-setting-label' });
		const newInput = body.createEl('textarea', { cls: 'wn-merge-revision-input' });
		newInput.value = this.originalText;

		// 3. 修稿思考备注
		body.createEl('label', { text: '修稿思考 / 批注备注：', cls: 'wn-setting-label' });
		const noteInput = body.createEl('textarea', { cls: 'wn-merge-revision-note-textarea' });
		noteInput.placeholder = t('merge.revision-note-placeholder');

		// 4. 按钮组
		const btnRow = contentEl.createDiv({ cls: 'wn-merge-modal-footer' });
		const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnRow.createEl('button', { text: t('common.confirm'), cls: 'mod-cta' });
		confirmBtn.onclick = () => {
			const val = newInput.value.trim();
			if (val && val !== this.originalText) {
				this.onSubmit(val, noteInput.value.trim());
				this.close();
			} else {
				new Notice(t('notice.select-text-first'));
			}
		};

		window.setTimeout(() => {
			newInput.focus();
			newInput.select();
		}, 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * 精准词句级修订记录结构 (Explicit Snippet Revision)
 */
export interface ExplicitRevisionRecord {
	/** 唯一修订 ID */
	id: string;
	/** 属于哪个章节条目 */
	item: ChapterMergeItem;
	/** 修改前选中的原文片段 */
	originalText: string;
	/** 修改后的新文本片段 */
	currentText: string;
	/** 作者思考/批注备注 */
	noteText: string;
	/** 创建时间戳 */
	timestamp: number;
}

/**
 * 章节合并与原稿无缝预览 Modal (ChapterMergeModal)
 *
 * 【Word 风格修订模式与三栏设计】
 * 1. 左栏 (220px): 目录大纲 (TOC Navigator)，支持平滑滚动定位、搜索过滤与修改标记。
 * 2. 中栏 (Flex 1): 原稿正文无缝流 (Seamless Content Stream)，纯粹高保真文本阅读与精准选中文本右键标注；
 *    仅针对被修改的具体词句进行下划高亮 Target Span 包裹，绝不下划包裹整段。
 * 3. 右栏 (320px): Word 风格批注侧栏 (Track Changes Revision Sidebar)，
 *    点击修订卡片可精准将正文高亮处滚动至中央并触发脉冲高亮闪烁，界面整洁无虚线干扰。
 * 4. 底部 Footer: 钉底固定在 modalEl 根节点，保证【应用覆盖原文】【导出合并文档】100% 显眼固定。
 */
export class ChapterMergeModal extends Modal {
	private plugin: WebNovelAssistantPlugin;
	private folder: TFolder;
	private items: ChapterMergeItem[] = [];
	private filteredItems: ChapterMergeItem[] = [];
	private searchQuery: string = '';
	/** 是否合并文档标题 (默认开启) */
	private includeTitles: boolean = true;

	/** 内存记录的词句级精准修订映射 (itemFilePath -> ExplicitRevisionRecord[]) */
	private explicitRevisionsMap: Map<string, ExplicitRevisionRecord[]> = new Map();

	// DOM 引用
	private statsEl!: HTMLElement;
	private tocContainerEl!: HTMLElement;
	private previewContainerEl!: HTMLElement;
	private annotationContainerEl!: HTMLElement;
	private bodyContainerEl!: HTMLElement;
	private draftNoticeEl!: HTMLElement | null;
	/** 当前中栏视口正文对应的章节文件路径 key */
	private activeChapterFilePath: string = '';

	/** 是否正在执行提交保存操作，防止重复关闭拦截 */
	private isSubmitting: boolean = false;

	constructor(app: typeof plugin.app, plugin: WebNovelAssistantPlugin, folder: TFolder) {
		super(app);
		this.plugin = plugin;
		this.folder = folder;
	}

	async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		// 为 Modal 根容器添加三栏宽屏 CSS 类名与排版变量
		modalEl.addClass('wn-merge-modal-window');
		contentEl.addClass('wn-merge-modal-content');
		this.applyTypographyToModal(modalEl);

		// 加载章节数据
		this.items = await this.plugin.chapterMergeManager.loadFolderChapters(this.folder);
		this.filteredItems = [...this.items];
		if (this.items.length > 0) {
			this.activeChapterFilePath = encodeURIComponent(this.items[0].file.path);
		}

		// 检查并自动静默恢复草稿与修稿卡片
		await this.checkAndApplyDraft();

		// 1. 渲染头部栏
		this.renderHeader(contentEl);

		// 2. 渲染主三栏内容区 (左:大纲 | 中:正文流 | 右:Word风格修订侧栏)
		this.bodyContainerEl = contentEl.createDiv({ cls: 'wn-merge-modal-body' });
		this.renderTocPane(this.bodyContainerEl);
		this.renderPreviewPane(this.bodyContainerEl);
		this.renderAnnotationPane(this.bodyContainerEl);

		// 3. 渲染底部按钮栏（直接挂载在 modalEl 根节点，绝对不被滚动遮挡）
		this.renderFooter(modalEl);

		// 初始化数据统计显示
		this.updateStats();
	}

	/**
	 * 检查并静默自动恢复草稿（含修改正文与词句级批注修订卡片）
	 */
	private async checkAndApplyDraft(): Promise<void> {
		const draft = await this.plugin.chapterMergeManager.loadDraft(this.folder.path);
		if (!draft || (!draft.items && !draft.revisions)) return;

		if (draft.items) {
			for (const item of this.items) {
				const saved = draft.items[item.file.path];
				if (saved) {
					item.currentBody = saved.currentBody;
					item.annotation = saved.annotation;
					item.isModified = (item.currentBody !== item.originalBody || item.annotation !== item.originalAnnotation);
				}
			}
		}

		// 恢复词句级精准修订卡片与批注
		if (draft.revisions) {
			this.explicitRevisionsMap.clear();
			for (const item of this.items) {
				const revs = draft.revisions[item.file.path];
				if (revs && revs.length > 0) {
					const restoredRevs: ExplicitRevisionRecord[] = revs.map(r => ({
						id: r.id,
						item,
						originalText: r.originalText,
						currentText: r.currentText,
						noteText: r.noteText,
						timestamp: r.timestamp
					}));
					this.explicitRevisionsMap.set(item.file.path, restoredRevs);
					item.isModified = true;
				}
			}
		}
	}

	/**
	 * 渲染头部统计与标题
	 */
	private renderHeader(container: HTMLElement): void {
		const headerEl = container.createDiv({ cls: 'wn-merge-modal-header' });

		const titleEl = headerEl.createDiv({
			text: t('merge.modal-title', { name: this.folder.name }),
			cls: 'wn-merge-modal-title'
		});
		setIcon(titleEl.createSpan({ cls: 'wn-merge-title-icon' }), 'book-open');

		this.statsEl = headerEl.createDiv({ cls: 'wn-merge-stats-badge' });
	}

	/**
	 * 1. 渲染左侧目录大纲栏 (TOC Pane)
	 */
	private renderTocPane(container: HTMLElement): void {
		const tocPane = container.createDiv({ cls: 'wn-merge-toc-pane' });

		// 搜索过滤框
		const searchWrapper = tocPane.createDiv({ cls: 'wn-merge-search-wrapper' });
		const searchIcon = searchWrapper.createSpan({ cls: 'wn-merge-search-icon' });
		setIcon(searchIcon, 'search');

		const searchInput = searchWrapper.createEl('input', {
			type: 'text',
			placeholder: t('merge.search-placeholder'),
			cls: 'wn-merge-search-input'
		});

		searchInput.oninput = () => {
			this.searchQuery = searchInput.value.trim().toLowerCase();
			this.filterTocList();
		};

		// 目录列表容器
		this.tocContainerEl = tocPane.createDiv({ cls: 'wn-merge-toc-list' });
		this.renderTocItems();
	}

	/**
	 * 过滤目录大纲列表
	 */
	private filterTocList(): void {
		if (!this.searchQuery) {
			this.filteredItems = [...this.items];
		} else {
			this.filteredItems = this.items.filter(item =>
				item.title.toLowerCase().includes(this.searchQuery) ||
				item.volumeName.toLowerCase().includes(this.searchQuery)
			);
		}
		this.renderTocItems();
	}

	/**
	 * 渲染目录大纲项列表
	 */
	private renderTocItems(): void {
		this.tocContainerEl.empty();
		let lastVolume = '';

		for (const item of this.filteredItems) {
			// 卷标题分隔
			if (item.volumeName && item.volumeName !== lastVolume) {
				lastVolume = item.volumeName;
				const volEl = this.tocContainerEl.createDiv({ cls: 'wn-merge-toc-volume' });
				const volIcon = volEl.createSpan({ cls: 'wn-merge-vol-icon' });
				setIcon(volIcon, 'folder');
				volEl.createSpan({ text: lastVolume });
			}

			// 章节条目
			const pathKey = encodeURIComponent(item.file.path);
			const itemEl = this.tocContainerEl.createDiv({ cls: 'wn-merge-toc-item' });
			itemEl.setAttribute('data-filepath', pathKey);

			if (pathKey === this.activeChapterFilePath) {
				itemEl.addClass('is-active');
			}
			if (item.isModified) {
				itemEl.addClass('is-modified');
			}

			const dotEl = itemEl.createSpan({ cls: 'wn-merge-status-dot' });
			if (item.isModified) {
				dotEl.addClass('active');
			}

			itemEl.createSpan({ text: item.title, cls: 'wn-merge-toc-title' });
			if (item.isModified) {
				itemEl.createSpan({ text: t('merge.status-modified'), cls: 'wn-merge-toc-mod-tag' });
			}

			// 点击平滑定位中间正文及右侧批注
			itemEl.onclick = () => {
				this.activeChapterFilePath = pathKey;
				this.updateActiveTocHighlight();
				const cardEl = this.previewContainerEl.querySelector(`[data-filepath="${pathKey}"]`);
				if (cardEl) {
					cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
				const annoCard = this.annotationContainerEl.querySelector(`[data-anno-filepath="${pathKey}"]`);
				if (annoCard) {
					annoCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			};
		}
	}

	/**
	 * 2. 渲染中间无缝正文预览流 (Main Preview Stream)
	 */
	private renderPreviewPane(container: HTMLElement): void {
		this.previewContainerEl = container.createDiv({ cls: 'wn-merge-preview-pane' });
		this.renderPreviewCards();
		this.setupTocScrollSync();
	}

	/**
	 * 设置正文流滚动与左侧 TOC 大纲的实时当前章节高亮联动
	 */
	private setupTocScrollSync(): void {
		if (!this.previewContainerEl) return;

		this.previewContainerEl.onscroll = () => {
			const chapterCards = Array.from(
				this.previewContainerEl.querySelectorAll<HTMLElement>('.wn-merge-chapter-card')
			);
			if (chapterCards.length === 0) return;

			const containerTop = this.previewContainerEl.getBoundingClientRect().top;
			let activePath = '';

			for (const card of chapterCards) {
				const rect = card.getBoundingClientRect();
				// 当卡片顶部距视口顶部 150px 以内或卡片穿过视口顶部时判定为当前阅读章节
				if (rect.top - containerTop <= 150 && rect.bottom - containerTop > 50) {
					activePath = card.getAttribute('data-filepath') || '';
				}
			}

			if (!activePath && chapterCards.length > 0) {
				activePath = chapterCards[0].getAttribute('data-filepath') || '';
			}

			if (activePath && activePath !== this.activeChapterFilePath) {
				this.activeChapterFilePath = activePath;
				this.updateActiveTocHighlight();
			}
		};
	}

	/**
	 * 更新左侧 TOC 目录高亮与平滑滚动可见性
	 */
	private updateActiveTocHighlight(): void {
		if (!this.tocContainerEl) return;

		const allItems = this.tocContainerEl.querySelectorAll<HTMLElement>('.wn-merge-toc-item');
		allItems.forEach(el => {
			const path = el.getAttribute('data-filepath');
			if (path === this.activeChapterFilePath) {
				el.addClass('is-active');
				el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			} else {
				el.removeClass('is-active');
			}
		});
	}

	/**
	 * 绑定全章节正文选中文本右键菜单修改事件
	 */
	private bindContextMenuRevision(containerEl: HTMLElement, item: ChapterMergeItem): void {
		containerEl.oncontextmenu = (e: MouseEvent) => {
			const sel = activeWindow.getSelection() || window.getSelection();
			const selectedText = sel ? sel.toString().trim() : '';

			if (selectedText && selectedText.length > 0) {
				e.preventDefault();
				e.stopPropagation();

				new SelectionRevisionModal(this.app, selectedText, (newText, noteText) => {
					// 1. 将正文中选中的具体词句替换为 newText
					item.currentBody = item.currentBody.replace(selectedText, newText);
					if (noteText) {
						item.annotation = noteText;
					}
					item.isModified = (item.currentBody !== item.originalBody || item.annotation !== item.originalAnnotation);

					// 2. 添加精准的词句级修订记录
					const revs = this.explicitRevisionsMap.get(item.file.path) || [];
					const newRev: ExplicitRevisionRecord = {
						id: `rev-${encodeURIComponent(item.file.path)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
						item,
						originalText: selectedText,
						currentText: newText,
						noteText,
						timestamp: Date.now()
					};
					revs.push(newRev);
					this.explicitRevisionsMap.set(item.file.path, revs);

					this.updateStats();
					this.renderTocItems();
					this.renderPreviewCards();
					this.renderRevisionCards();
					this.plugin.chapterMergeManager.saveDraft(this.folder.path, this.items, this.explicitRevisionsMap);
				}).open();
			}
		};
	}

	/**
	 * 渲染正文高亮 Target Span 与段落（精准高亮被修改的具体词句，绝不下划包裹一整段）
	 */
	private renderChapterRenderView(containerEl: HTMLElement, item: ChapterMergeItem): void {
		containerEl.empty();

		const chapRevisions = this.explicitRevisionsMap.get(item.file.path) || [];
		const lines = item.currentBody.split(/\r?\n/);

		// 如果本章没有精准修订记录，按标准段落 `<p class="wn-merge-para">` 渲染（支持真实 CSS 缩进与选中文本）
		if (chapRevisions.length === 0) {
			for (const line of lines) {
				const p = containerEl.createEl('p', { cls: 'wn-merge-para' });
				if (line.trim().length > 0) {
					p.setText(line);
				} else {
					p.addClass('wn-merge-para-empty');
					p.setText('\u00A0');
				}
			}
			this.bindContextMenuRevision(containerEl, item);
			return;
		}

		// 如果存在精准词句修订，仅在段落中将 `rev.currentText` 精准包裹在 `<span class="wn-manuscript-inline-revision-target">`
		for (const line of lines) {
			const p = containerEl.createEl('p', { cls: 'wn-merge-para' });
			if (!line.trim()) {
				p.addClass('wn-merge-para-empty');
				p.setText('\u00A0');
				continue;
			}

			// 匹配行中是否存在任何 `currentText`
			const lineRevs = chapRevisions.filter(r => r.currentText.trim() && line.includes(r.currentText.trim()));

			if (lineRevs.length > 0) {
				// 按匹配的修订渲染节点
				let remainingLine = line;
				for (const rev of lineRevs) {
					const targetText = rev.currentText.trim();
					const parts = remainingLine.split(targetText);
					if (parts.length > 1) {
						p.createSpan({ text: parts[0] });
						const targetSpan = p.createSpan({
							text: targetText,
							cls: 'wn-manuscript-inline-revision-target'
						});
						targetSpan.setAttribute('data-rev-id', rev.id);
						remainingLine = parts.slice(1).join(targetText);
					}
				}
				if (remainingLine) {
					p.createSpan({ text: remainingLine });
				}
			} else {
				p.setText(line);
			}
		}

		this.bindContextMenuRevision(containerEl, item);
	}

	/**
	 * 渲染中间正文卡片列表（单章节唯一 DOM 节点）
	 */
	private renderPreviewCards(): void {
		this.previewContainerEl.empty();
		let lastVolume = '';

		for (const item of this.items) {
			// 卷标题分割 (仅在开启合并文档标题时渲染)
			if (this.includeTitles && item.volumeName && item.volumeName !== lastVolume) {
				lastVolume = item.volumeName;
				const volDivider = this.previewContainerEl.createDiv({ cls: 'wn-merge-preview-vol-divider' });
				volDivider.createDiv({ text: lastVolume, cls: 'wn-merge-vol-divider-title' });
			}

			// 章节预览编辑卡片
			const cardEl = this.previewContainerEl.createDiv({ cls: 'wn-merge-chapter-card' });
			cardEl.setAttribute('data-filepath', encodeURIComponent(item.file.path));

			// 1. 卡片头部栏
			const cardHeader = cardEl.createDiv({ cls: 'wn-merge-card-header' });

			const titleInfo = cardHeader.createDiv({ cls: 'wn-merge-card-title-group' });
			const fileIcon = titleInfo.createSpan({ cls: 'wn-merge-card-icon' });
			setIcon(fileIcon, 'file-text');

			if (this.includeTitles) {
				titleInfo.createSpan({ text: item.title, cls: 'wn-merge-card-title' });
			}

			const words = this.plugin.calculateAccurateWords(item.currentBody);
			const wordBadge = titleInfo.createSpan({ text: `${words.toLocaleString()} ${t('common.word-char')}`, cls: 'wn-merge-card-badge' });

			if (item.isModified) {
				titleInfo.createSpan({ text: t('merge.status-modified'), cls: 'wn-merge-card-mod-tag' });
			}

			// 重置还原按钮
			const btnGroup = cardHeader.createDiv({ cls: 'wn-merge-card-actions' });

			const resetBtn = btnGroup.createEl('button', { cls: 'wn-merge-card-btn-reset' });
			setIcon(resetBtn, 'rotate-ccw');
			resetBtn.title = t('merge.btn-reset-chapter');
			if (!item.isModified) {
				resetBtn.disabled = true;
			}

			// 2. 正文主体容器：高保真原稿阅读渲染，无缝文本选择与右键标注
			const bodyContainer = cardEl.createDiv({ cls: 'wn-merge-card-body-wrapper' });
			const renderViewEl = bodyContainer.createDiv({ cls: 'wn-merge-card-render-view' });
			this.renderChapterRenderView(renderViewEl, item);

			resetBtn.onclick = () => {
				item.currentBody = item.originalBody;
				item.annotation = item.originalAnnotation;
				item.isModified = false;
				this.explicitRevisionsMap.delete(item.file.path);
				this.onItemContentChanged(item, wordBadge, resetBtn);
				this.renderPreviewCards();
			};
		}
	}

	/**
	 * 3. 渲染右侧 Word 风格词句级修订与批注侧栏 (Explicit Revision Sidebar Pane)
	 */
	private renderAnnotationPane(container: HTMLElement): void {
		const annoPane = container.createDiv({ cls: 'wn-merge-annotation-pane' });

		// 侧栏头部
		const header = annoPane.createDiv({ cls: 'wn-merge-anno-pane-header' });
		const iconSpan = header.createSpan({ cls: 'wn-merge-anno-pane-icon' });
		setIcon(iconSpan, 'file-diff');
		header.createSpan({ text: t('merge.revision-title'), cls: 'wn-merge-anno-pane-title' });

		// 修订卡片列表容器
		this.annotationContainerEl = annoPane.createDiv({ cls: 'wn-merge-anno-card-list' });
		this.renderRevisionCards();
	}

	/**
	 * 获取全书所有的精准词句级修订条目
	 */
	private computeAllRevisions(): ExplicitRevisionRecord[] {
		const revisions: ExplicitRevisionRecord[] = [];
		for (const item of this.items) {
			const revs = this.explicitRevisionsMap.get(item.file.path) || [];
			revisions.push(...revs);
		}
		return revisions;
	}

	/**
	 * 渲染右侧 Word 风格精准词句级修订与原文对照卡片
	 */
	private renderRevisionCards(): void {
		this.annotationContainerEl.empty();

		const revisions = this.computeAllRevisions();

		if (revisions.length === 0) {
			const emptyState = this.annotationContainerEl.createDiv({ cls: 'wn-merge-revision-empty' });
			const emptyIcon = emptyState.createDiv({ cls: 'wn-merge-empty-icon' });
			setIcon(emptyIcon, 'check-check');
			emptyState.createDiv({ text: t('merge.no-revisions'), cls: 'wn-merge-empty-text' });
			return;
		}

		for (const rev of revisions) {
			const card = this.annotationContainerEl.createDiv({ cls: 'wn-merge-revision-card' });
			card.setAttribute('data-rev-id', rev.id);
			card.setAttribute('data-anno-filepath', encodeURIComponent(rev.item.file.path));

			// 1. 修订头：章节名 + 定位与单项还原按钮
			const cardHeader = card.createDiv({ cls: 'wn-merge-revision-card-header' });

			const titleGroup = cardHeader.createDiv({ cls: 'wn-merge-rev-title-group' });
			titleGroup.createSpan({ text: rev.item.title, cls: 'wn-merge-rev-chap-title' });

			const btnActions = cardHeader.createDiv({ cls: 'wn-merge-rev-card-actions' });

			// 【定位到此处】按钮
			const locateBtn = btnActions.createEl('button', { cls: 'wn-merge-rev-btn-locate' });
			setIcon(locateBtn, 'crosshair');
			locateBtn.title = t('merge.revision-locate');
			locateBtn.onclick = (e) => {
				e.stopPropagation();
				this.locateAndHighlightSentence(rev);
			};

			// 【还原此项】按钮
			const revertBtn = btnActions.createEl('button', { cls: 'wn-merge-rev-btn-revert' });
			setIcon(revertBtn, 'undo-2');
			revertBtn.title = t('merge.revision-revert');

			revertBtn.onclick = (e) => {
				e.stopPropagation();
				this.revertSingleRevision(rev);
			};

			// 点击卡片整体平滑定位
			card.onclick = () => {
				this.locateAndHighlightSentence(rev);
			};

			// 2. 原文片段与修改后片段对比（显著样式区分）
			const diffBox = card.createDiv({ cls: 'wn-merge-revision-diff-box' });

			if (rev.originalText.trim()) {
				const origBox = diffBox.createDiv({ cls: 'wn-merge-rev-orig-box' });
				origBox.createSpan({ text: '原: ', cls: 'wn-merge-rev-tag-orig' });
				const delEl = origBox.createEl('s', { cls: 'wn-merge-rev-orig-text' });
				delEl.setText(rev.originalText.trim());
			}

			if (rev.currentText.trim()) {
				const currBox = diffBox.createDiv({ cls: 'wn-merge-rev-curr-box' });
				currBox.createSpan({ text: '改: ', cls: 'wn-merge-rev-tag-curr' });
				const insEl = currBox.createSpan({ cls: 'wn-merge-rev-curr-text' });
				insEl.setText(rev.currentText.trim());
			}

			// 3. 作者思考/备注框
			if (rev.noteText) {
				const noteBox = card.createDiv({ cls: 'wn-merge-rev-note-box' });
				noteBox.createSpan({ text: `💭 ${rev.noteText}`, cls: 'wn-merge-rev-note-text' });
			}
		}
	}

	/**
	 * 高亮并精准定位选中正文中修改的具体词句（直接将 targetSpan 居中显示并触发 Flash 脉冲）
	 */
	private locateAndHighlightSentence(rev: ExplicitRevisionRecord): void {
		const targetSpan = this.previewContainerEl.querySelector<HTMLElement>(
			`.wn-manuscript-inline-revision-target[data-rev-id="${rev.id}"]`
		);

		if (targetSpan) {
			targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
			targetSpan.addClass('is-flashing');
			window.setTimeout(() => targetSpan.removeClass('is-flashing'), 2000);

			const cardEl = this.annotationContainerEl.querySelector<HTMLElement>(
				`.wn-merge-revision-card[data-rev-id="${rev.id}"]`
			);
			if (cardEl) {
				cardEl.addClass('is-hovered');
				window.setTimeout(() => cardEl.removeClass('is-hovered'), 2000);
			}
		} else {
			const cardEl = this.previewContainerEl.querySelector(`[data-filepath="${encodeURIComponent(rev.item.file.path)}"]`);
			if (cardEl) {
				cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		}
	}

	/**
	 * 还原单项精准词句修改
	 */
	private revertSingleRevision(rev: ExplicitRevisionRecord): void {
		rev.item.currentBody = rev.item.currentBody.replace(rev.currentText, rev.originalText);

		let revs = this.explicitRevisionsMap.get(rev.item.file.path) || [];
		revs = revs.filter(r => r.id !== rev.id);
		this.explicitRevisionsMap.set(rev.item.file.path, revs);

		rev.item.isModified = (rev.item.currentBody !== rev.item.originalBody || rev.item.annotation !== rev.item.originalAnnotation);

		this.updateStats();
		this.renderTocItems();
		this.renderPreviewCards();
		this.renderRevisionCards();
		this.plugin.chapterMergeManager.saveDraft(this.folder.path, this.items, this.explicitRevisionsMap);
	}

	/**
	 * 单章正文变动后的响应回调
	 */
	private onItemContentChanged(
		item: ChapterMergeItem,
		wordBadge: HTMLElement,
		resetBtn: HTMLButtonElement
	): void {
		item.isModified = (item.currentBody !== item.originalBody || item.annotation !== item.originalAnnotation);
		resetBtn.disabled = !item.isModified;

		const words = this.plugin.calculateAccurateWords(item.currentBody);
		wordBadge.setText(`${words.toLocaleString()} ${t('common.word-char')}`);

		// 刷新全局统计、TOC 状态与 Word 风格修订卡片列表
		this.updateStats();
		this.renderTocItems();
		this.renderRevisionCards();

		// 异步暂存草稿
		this.plugin.chapterMergeManager.saveDraft(this.folder.path, this.items, this.explicitRevisionsMap);
	}

	/**
	 * 更新全书字数与修改统计
	 */
	private updateStats(): void {
		let totalWords = 0;
		let modifiedCount = 0;

		for (const item of this.items) {
			totalWords += this.plugin.calculateAccurateWords(item.currentBody);
			if (item.isModified) modifiedCount++;
		}

		this.statsEl.setText(t('merge.stats-info', {
			chapters: String(this.items.length),
			words: totalWords.toLocaleString(),
			modified: String(modifiedCount)
		}));
	}

	/**
	 * 刷新整体 UI
	 */
	private refreshUI(): void {
		this.updateStats();
		this.renderTocItems();
		this.renderPreviewCards();
		this.renderRevisionCards();
	}

	/**
	 * 渲染底部操作按钮组（钉底固定在最下方）
	 */
	private renderFooter(container: HTMLElement): void {
		const footerEl = container.createDiv({ cls: 'wn-merge-modal-footer' });

		const leftGroup = footerEl.createDiv({ cls: 'wn-merge-footer-left' });

		// 是否合并文档标题复选框 (默认开启)
		const titleLabel = leftGroup.createEl('label', { cls: 'wn-merge-checkbox-label' });
		const titleCheckbox = titleLabel.createEl('input', { type: 'checkbox', cls: 'wn-merge-checkbox-input' });
		titleCheckbox.checked = this.includeTitles;
		titleLabel.createSpan({ text: t('merge.include-titles'), cls: 'wn-merge-checkbox-text' });

		titleCheckbox.onchange = () => {
			this.includeTitles = titleCheckbox.checked;
			this.renderPreviewCards();
		};

		// 1. 应用覆盖原文
		const applyBtn = leftGroup.createEl('button', { text: t('merge.btn-apply-originals'), cls: 'wn-btn-apply' });
		applyBtn.onclick = () => void this.handleApplyOriginals();

		const rightGroup = footerEl.createDiv({ cls: 'wn-merge-footer-right' });

		// 2. 应用并导出
		const applyExportBtn = rightGroup.createEl('button', { text: t('merge.btn-apply-and-export'), cls: 'wn-btn-apply-export' });
		applyExportBtn.onclick = () => void this.handleApplyAndExport();

		// 3. 导出合并文档 (主要按钮 mod-cta)
		const exportBtn = rightGroup.createEl('button', { text: t('merge.btn-export-merged'), cls: 'mod-cta wn-btn-export' });
		exportBtn.onclick = () => void this.handleExportMerged();

		// 4. 取消 / 关闭
		const cancelBtn = rightGroup.createEl('button', { text: t('common.cancel'), cls: 'wn-btn-cancel' });
		cancelBtn.onclick = () => this.close();
	}

	/**
	 * 处理“应用覆盖原文”
	 */
	private async handleApplyOriginals(): Promise<void> {
		const count = await this.plugin.chapterMergeManager.saveToOriginalFiles(this.items);
		this.plugin.chapterMergeManager.clearDraft(this.folder.path);
		new Notice(t('notice.apply-originals-success', { count: String(count) }));
		this.refreshUI();
	}

	/**
	 * 处理“导出合并文档”
	 */
	private async handleExportMerged(): Promise<void> {
		this.isSubmitting = true;
		const { file: mergedFile, wordCount } = await this.plugin.chapterMergeManager.exportMergedDocument(this.folder, this.items, this.includeTitles);
		this.plugin.chapterMergeManager.clearDraft(this.folder.path);

		new Notice(t('notice.merge-success', {
			count: String(this.items.length),
			words: wordCount.toLocaleString(),
			overwriteHint: ''
		}));

		await this.app.workspace.getLeaf(false).openFile(mergedFile);
		this.close();
	}

	/**
	 * 处理“应用并导出”
	 */
	private async handleApplyAndExport(): Promise<void> {
		this.isSubmitting = true;
		await this.plugin.chapterMergeManager.saveToOriginalFiles(this.items);
		const { file: mergedFile } = await this.plugin.chapterMergeManager.exportMergedDocument(this.folder, this.items, this.includeTitles);
		this.plugin.chapterMergeManager.clearDraft(this.folder.path);

		new Notice(t('notice.apply-originals-success', { count: String(this.items.length) }));
		await this.app.workspace.getLeaf(false).openFile(mergedFile);
		this.close();
	}

	/**
	 * 关闭时的二次确认防护逻辑
	 */
	onClose(): void {
		// 如果正在提交保存，直接清理
		if (this.isSubmitting) {
			this.contentEl.empty();
			return;
		}

		const hasUnsaved = this.items.some(item => item.isModified);
		if (hasUnsaved) {
			// 将当前草稿写入持久暂存
			this.plugin.chapterMergeManager.saveDraft(this.folder.path, this.items, this.explicitRevisionsMap);
		}

		this.contentEl.empty();
	}

	/**
	 * 将排版设置应用的 CSS 变量和 Class 注入预览 Modal
	 */
	private applyTypographyToModal(containerEl: HTMLElement): void {
		const typo = this.plugin.settings.typography;
		if (!typo) return;

		containerEl.addClass('wn-typography-active');

		containerEl.style.setProperty('--wn-type-header-align', typo.headerAlignment || 'center');
		containerEl.style.setProperty('--wn-type-indent', typo.enableIndent ? (typo.indentSize || '2em') : '0');
		containerEl.style.setProperty('--wn-type-line-height', String(typo.lineHeight || 1.8));
		containerEl.style.setProperty('--wn-type-para-spacing', typo.paragraphSpacing || '0.5em');
		containerEl.style.setProperty('--wn-type-letter-spacing', typo.letterSpacing || '0.05em');
		containerEl.style.setProperty('--wn-type-text-align', typo.justifyText ? 'justify' : 'left');
	}
}
