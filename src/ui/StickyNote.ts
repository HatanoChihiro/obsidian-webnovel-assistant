import type { App} from 'obsidian';
import { Component, MarkdownRenderer, Notice, TFile, setIcon, Modal, Setting, MarkdownView, Platform } from 'obsidian';
import type { StickyNoteState, ThemeScheme } from '../types/settings';
import { hexToRgba } from '../utils/format';
import { isDesktop } from '../utils/platform';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 保存便签对话框
 */
export class SaveStickyNoteModal extends Modal {
	plugin: WebNovelAssistantPlugin;
	onSubmit: (fileName: string, folderPath: string) => void;
	fileNameInput!: HTMLInputElement;
	folderPathInput!: HTMLInputElement;

	constructor(app: App, plugin: WebNovelAssistantPlugin, onSubmit: (fileName: string, folderPath: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { text: '保存便签为文件' });
		
		// 获取当前活动文件的文件夹路径
		const activeFile = this.app.workspace.getActiveFile();
		const defaultFolder = activeFile?.parent?.path || '';
		
		// 文件名输入
		new Setting(contentEl)
			.setName('文件名')
			.setDesc('输入文件名（无需 .md 后缀）')
			.addText(text => {
				this.fileNameInput = text.inputEl;
				text.setValue(`便签_${activeWindow.moment().format('YYYYMMDD_HHmmss')}`)
					.onChange(() => {
						// 实时验证文件名
						const fileName = this.fileNameInput.value.trim();
						if (!fileName) {
							this.fileNameInput.setCssStyles({ borderColor: 'var(--background-modifier-error)' });
						} else {
							this.fileNameInput.setCssStyles({ borderColor: '' });
						}
					});
				text.inputEl.setCssStyles({ width: '100%' });
				
				// 自动选中文件名（不包括时间戳）
				activeWindow.setTimeout(() => {
					const underscoreIndex = text.inputEl.value.indexOf('_');
					if (underscoreIndex > 0) {
						text.inputEl.setSelectionRange(0, underscoreIndex);
					} else {
						text.inputEl.select();
					}
					text.inputEl.focus();
				}, 50);
			});
		
		// 文件夹路径输入
		new Setting(contentEl)
			.setName('保存位置')
			.setDesc('文件夹路径（留空保存到根目录）')
			.addText(text => {
				this.folderPathInput = text.inputEl;
				text.setValue(defaultFolder)
					.setPlaceholder('例如: 我的文件夹/子文件夹');
				text.inputEl.setCssStyles({ width: '100%' });
			});
		
		// 提示信息
		contentEl.createEl('p', { 
			text: '提示：默认保存到当前工作文件夹',
			cls: 'setting-item-description'
		});
		
		// 按钮
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		buttonContainer.setCssStyles({ display: 'flex' });
		buttonContainer.setCssStyles({ justifyContent: 'flex-end' });
		buttonContainer.setCssStyles({ gap: '10px' });
		buttonContainer.setCssStyles({ marginTop: '20px' });
		
		const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();
		
		const saveBtn = buttonContainer.createEl('button', { 
			text: '保存',
			cls: 'mod-cta'
		});
		saveBtn.onclick = () => {
			const fileName = this.fileNameInput.value.trim();
			const folderPath = this.folderPathInput.value.trim();
			
			if (!fileName) {
				new Notice('[错误] 请输入文件名');
				this.fileNameInput.focus();
				return;
			}
			
			this.onSubmit(fileName, folderPath);
			this.close();
		};
		
		// 回车键保存
		this.fileNameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveBtn.click();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * 确认关闭便签对话框
 */
export class ConfirmCloseModal extends Modal {
	onSubmit: (shouldSave: boolean) => void;

	constructor(app: App, onSubmit: (shouldSave: boolean) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { text: '有未保存的更改' });
		
		contentEl.createEl('p', { 
			text: '便签内容已修改但尚未保存，是否要保存更改？'
		});
		
		// 按钮
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		buttonContainer.setCssStyles({ display: 'flex' });
		buttonContainer.setCssStyles({ justifyContent: 'flex-end' });
		buttonContainer.setCssStyles({ gap: '10px' });
		buttonContainer.setCssStyles({ marginTop: '20px' });
		
		const dontSaveBtn = buttonContainer.createEl('button', { text: '不保存' });
		dontSaveBtn.onclick = () => {
			this.onSubmit(false);
			this.close();
		};
		
		const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();
		
		const saveBtn = buttonContainer.createEl('button', { 
			text: '保存',
			cls: 'mod-cta'
		});
		saveBtn.onclick = () => {
			this.onSubmit(true);
			this.close();
		};
		
		// ESC 键取消
		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * 悬浮便签组件
 * 可拖拽、可缩放、可自定义主题的浮动便签
 */
export class FloatingStickyNote extends Component {
	app: App;
	plugin: WebNovelAssistantPlugin;
	state: StickyNoteState;
	containerEl!: HTMLElement;
	contentContainer!: HTMLDivElement;
	textareaEl!: HTMLTextAreaElement;
	initialContent: string; // 用于检测未保存的更改
	lastSavedContent: string = ""; // 最后一次保存的内容
	private resizeObserver: ResizeObserver | null = null; // ResizeObserver 实例
	private resizeTimer: number | null = null;           // ResizeObserver 防抖计时器

	constructor(app: App, plugin: WebNovelAssistantPlugin, options: { file?: TFile, content?: string, title?: string, state?: StickyNoteState }) {
		super();
		this.app = app;
		this.plugin = plugin;
		
		if (options.state) {
			this.state = options.state;
			if (!this.state.zoomLevel) this.state.zoomLevel = 1;
			if (!this.state.textColor) this.state.textColor = '#2C3E50'; 
		} else {
			// 获取当前主题并轮转索引
			const themes = this.plugin.settings.noteThemes;
			const themeIndex = (this.plugin.settings.nextNoteThemeIndex || 0) % themes.length;
			const theme = themes[themeIndex];

			this.state = {
				id: crypto.randomUUID().substring(0, 8),
				filePath: options.file?.path,
				content: options.content || "",
				title: options.title || (options.file ? options.file.basename : "新便签"),
				top: "150px",
				left: "150px",
				width: "320px",
				height: "450px",
				color: theme.bg,
				textColor: theme.text,
				isEditing: !options.file && !options.content,
				isPinned: false,
				zoomLevel: 1 
			};

			// 更新下一次的索引并持久化
			this.plugin.settings.nextNoteThemeIndex = (themeIndex + 1) % themes.length;
			this.plugin.saveSettings().catch(err => {
				console.error('[StickyNote] 更新颜色索引失败:', err);
			});
		}
		
		// 保存初始内容，用于检测是否有未保存的更改
		this.initialContent = this.state.content || "";
	}

	/**
	 * 静默销毁实例（通常由同步逻辑调用）
	 * 不触发保存提示，不从 settings 中删除，仅清理 DOM 和监听器
	 */
	destroy() {
		this.unload();
	}

	/**
	 * 从另一个状态对象更新当前便签的显示（通常由同步逻辑调用）
	 */
	updateFromState(newState: StickyNoteState) {
		this.state = { ...this.state, ...newState };
		this.lastSavedContent = this.state.content || "";
		if (this.textareaEl && this.state.content !== this.textareaEl.value) {
			this.textareaEl.value = this.state.content || "";
		}
		
		const titleEl = this.containerEl?.querySelector('.my-sticky-title') as HTMLElement;
		if (titleEl && this.state.title) {
			titleEl.innerText = this.state.title;
		}
		
		this.updateVisuals();
	}

	onunload() {
		// [L-P7] 确保在组件卸载时移除所有可能的全局拖拽监听器
		this.cleanupDragging();
		// 清理 ResizeObserver
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		// [BUGFIX] 清理可能尚在延迟中的 resize 防抖计时器，防止其在实例销毁后还尝试操作 DOM。
		if (this.resizeTimer !== null) {
			activeWindow.clearTimeout(this.resizeTimer);
			this.resizeTimer = null;
		}
		
		if (this.containerEl) {
			this.containerEl.remove();
		}
		
		// 从插件的 activeNotes 列表中移除自身
		const index = this.plugin.activeNotes.indexOf(this);
		if (index !== -1) {
			this.plugin.activeNotes.splice(index, 1);
		}
	}

	async onload() {
		// 终极防御：非桌面端禁止加载浮动 UI
		if (!isDesktop()) {
			return;
		}
		this.plugin.activeNotes.push(this);
		
		this.containerEl = activeDocument.body.createDiv({ cls: 'my-floating-sticky-note' });
		
		if (this.state.filePath && !this.state.content) {
			const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
			if (file instanceof TFile) {
				this.state.content = await this.app.vault.read(file);
			}
		}
		
		// 初始化最后保存的内容
		this.lastSavedContent = this.state.content || "";

		this.updateVisuals();

		// Ctrl+滚轮缩放
		this.containerEl.addEventListener('wheel', (e) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				e.stopPropagation();
				
				const currentZoom = this.state.zoomLevel || 1;
				const zoomStep = 0.1;
				const delta = e.deltaY < 0 ? zoomStep : -zoomStep;
				
				this.state.zoomLevel = Math.max(0.5, Math.min(4, currentZoom + delta));
				this.updateVisuals();
				this.saveState();
			}
		}, { passive: false });

		this.createHeader();
		await this.renderContent();
		
		const notes = this.plugin.stickyNoteManager.getNotes();
		if (!notes.find((n: StickyNoteState) => n.id === this.state.id)) {
			notes.push(this.state);
			this.plugin.stickyNoteManager.saveNotes(notes).catch(err => {
				console.error('[StickyNote] 保存便签列表失败:', err);
			});
		}
	}

	private createHeader() {
		const headerEl = this.containerEl.createDiv({ cls: 'my-sticky-header' });
		
		const titleWrapper = headerEl.createDiv({ cls: 'my-sticky-title-wrapper' });
		const titleIcon = titleWrapper.createSpan({ cls: 'my-sticky-title-icon' });
		setIcon(titleIcon, 'sticky-note');
		titleWrapper.createSpan({ text: this.state.title || '', cls: 'my-sticky-title' });
		
		const controlsEl = headerEl.createDiv({ cls: 'my-sticky-controls' });
		
		// 创建按钮
		const pinBtn = this.createButton(controlsEl, 'pin', this.state.isPinned);
		const saveBtn = this.createButton(controlsEl, 'save');
		saveBtn.title = '保存便签内容 (Ctrl+S)';
		saveBtn.setCssStyles({ opacity: '0.5' });
		const syncBtn = this.state.filePath ? this.createButton(controlsEl, 'refresh-cw') : null;
		if (syncBtn) syncBtn.title = '从关联文档同步内容';
		const toggleEditBtn = this.createButton(controlsEl, this.state.isEditing ? 'eye' : 'pencil');
		const paletteBtn = this.createButton(controlsEl, 'palette', false, 'palette-btn-target');
		const closeBtn = controlsEl.createEl('button', { cls: 'my-sticky-close' });
		setIcon(closeBtn, 'x');

		// 创建内容区域
		this.contentContainer = this.containerEl.createDiv({ cls: 'my-sticky-content markdown-rendered' });
		// 防止 contentContainer 接收焦点
		this.contentContainer.tabIndex = -1;
		this.textareaEl = this.containerEl.createEl('textarea', { cls: 'my-sticky-textarea' });

		// 1. 只需要在 textarea 级别阻止普通的事件冒泡即可
		const stopPropagation = (e: Event) => e.stopPropagation();
		this.textareaEl.addEventListener('keydown', stopPropagation);
		this.textareaEl.addEventListener('keyup', stopPropagation);
		this.textareaEl.addEventListener('keypress', stopPropagation);
		
		// 2. 【核心修复】解决按空格/回车自动跳转文档并抢夺焦点的问题
		this.textareaEl.addEventListener('focus', () => {
			// 获取当前活动视图，如果不是 Markdown 视图（比如停留在了文件浏览器或搜索栏）
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) {
				// 找一个已打开的 Markdown 视图
				const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
				if (mdLeaves.length > 0) {
					// 悄悄将 Obsidian 的逻辑焦点转移到 Markdown 视图上
					// { focus: false } 是关键：它只修改内部状态，绝不会抢走你 textarea 里的打字光标！
					this.app.workspace.setActiveLeaf(mdLeaves[0], { focus: false });
				}
			}
		});
		
		// 阻止 mousedown 事件冒泡，防止触发标题栏的拖拽
		this.textareaEl.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});

		// 监听输入以实现自动保存和视觉反馈
		this.textareaEl.addEventListener('input', () => {
			// 始终同步内存中的 content，确保 onunload 时数据不丢失
			this.state.content = this.textareaEl.value;
			// 视觉反馈：如果内容与最后保存的不一致，高亮保存按钮
			const isDirty = this.textareaEl.value !== this.lastSavedContent;
			if (isDirty && !this.plugin.settings.stickyNoteAutoSave) {
				saveBtn.setCssStyles({ opacity: '1' });
				saveBtn.setCssStyles({ color: 'var(--interactive-accent)' });
			} else {
				saveBtn.setCssStyles({ opacity: '0.5' });
				saveBtn.setCssStyles({ color: '' });
			}

			if (this.plugin.settings.stickyNoteAutoSave) {
				const debounceKey = `save-note-${this.state.id}`;
				this.plugin.adaptiveDebounceManager.debounceFixed(debounceKey, async () => {
					this.state.content = this.textareaEl.value;
					this.saveState();
					
					// 如果关联了文件，同步写入文件
					if (this.state.filePath) {
						const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
						if (file instanceof TFile) {
							await this.app.vault.modify(file, this.state.content || "");
							this.lastSavedContent = this.state.content || ""; // 同步后更新“最后保存”内容
						}
					}
					// 自动保存后恢复按钮状态
					saveBtn.setCssStyles({ opacity: '0.5' });
					saveBtn.setCssStyles({ color: '' });
				}, 500);
			}
		});

		// 创建调色板弹窗
		const popupEl = this.createPalettePopup(controlsEl);

		// 绑定事件
		this.bindHeaderEvents(pinBtn, saveBtn, syncBtn, toggleEditBtn, paletteBtn, closeBtn, popupEl, titleWrapper);
		this.setupDragging(headerEl);
		this.setupResizing();
	}

	private createButton(parent: HTMLElement, icon: string, isActive = false, extraClass = ''): HTMLButtonElement {
		const btn = parent.createEl('button', { cls: `my-sticky-btn ${extraClass}` });
		setIcon(btn, icon);
		if (isActive) btn.classList.add('is-active');
		return btn;
	}

	private createPalettePopup(parent: HTMLElement): HTMLElement {
		const popupEl = parent.createDiv({ cls: 'my-sticky-palette-popup' });
		this.plugin.settings.noteThemes.forEach((theme: ThemeScheme) => {
			const swatch = popupEl.createDiv({ cls: 'my-sticky-swatch' });
			swatch.setCssStyles({ backgroundColor: theme.bg });
			swatch.setCssStyles({ color: theme.text });
			swatch.innerText = "Aa"; 
			
			swatch.onclick = (e) => { 
				e.stopPropagation();
				this.state.color = theme.bg; 
				this.state.textColor = theme.text; 
				this.updateVisuals(); 
				this.saveState(); 
				popupEl.classList.remove('is-active'); 
			};
		});

		this.containerEl.addEventListener('click', (e) => {
			if (!(e.target as HTMLElement).closest('.my-sticky-palette-popup') && 
			    !(e.target as HTMLElement).closest('.palette-btn-target')) {
				popupEl.classList.remove('is-active');
			}
		});

		return popupEl;
	}

	private bindHeaderEvents(
		pinBtn: HTMLButtonElement,
		saveBtn: HTMLButtonElement,
		syncBtn: HTMLButtonElement | null,
		toggleEditBtn: HTMLButtonElement,
		paletteBtn: HTMLButtonElement,
		closeBtn: HTMLButtonElement,
		popupEl: HTMLElement,
		titleWrapper: HTMLElement
	) {
		paletteBtn.onclick = (e) => { 
			e.stopPropagation(); 
			popupEl.classList.toggle('is-active'); 
		};

		pinBtn.onclick = () => {
			this.state.isPinned = !this.state.isPinned;
			pinBtn.classList.toggle('is-active', this.state.isPinned);
			this.updateVisuals();
			this.saveState();
		};

		if (syncBtn) {
			syncBtn.onclick = async () => {
				if (this.state.filePath) {
					const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
					if (file instanceof TFile) {
						this.state.content = await this.app.vault.read(file);
						this.lastSavedContent = this.state.content;
						if (this.state.isEditing) this.textareaEl.value = this.state.content || '';
						await this.renderContent();
						new Notice('[成功] 已从文档同步内容');
					}
				}
			};
		}

		toggleEditBtn.onclick = async () => {
			if (this.state.isEditing) {
				this.state.content = this.textareaEl.value;
				if (this.state.filePath) {
					const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
					if (file instanceof TFile) await this.app.vault.modify(file, this.state.content);
				}
				this.state.isEditing = false;
				setIcon(toggleEditBtn, 'pencil');
			} else {
				if (this.state.filePath) {
					const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
					if (file instanceof TFile) {
						this.state.content = await this.app.vault.read(file);
					}
				}
				this.state.isEditing = true;
				setIcon(toggleEditBtn, 'eye');
			}
			await this.renderContent();
			this.saveState();
			
			// 确保编辑模式下焦点在 textarea
			if (this.state.isEditing) {
				// 使用 requestAnimationFrame 确保在下一帧设置焦点
				activeWindow.requestAnimationFrame(() => {
					this.textareaEl.focus();
				});
			}
		};

		saveBtn.onclick = async () => {
			if (this.state.isEditing) {
				this.state.content = this.textareaEl.value;
			}
			
			// 如果已经关联了文件，直接保存
			if (this.state.filePath) { 
				const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
				if (file instanceof TFile) {
					await this.app.vault.modify(file, this.state.content || "");
					this.lastSavedContent = this.state.content || ""; // 更新最后保存的内容
					new Notice("[成功] 便签已同步至原文档");
				}
				return; 
			}
			
			// 新便签：弹出对话框让用户自定义文件名和保存位置
			const modal = new SaveStickyNoteModal(this.app, this.plugin, async (fileName: string, folderPath: string) => {
				try {
					// 确保文件名以 .md 结尾
					if (!fileName.endsWith('.md')) {
						fileName += '.md';
					}
					
					// 构建完整路径
					const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
					
					// 检查文件是否已存在
					if (this.app.vault.getAbstractFileByPath(fullPath)) {
						new Notice(`[错误] 文件已存在: ${fullPath}`);
						return;
					}
					
					// 创建文件
					const file = await this.app.vault.create(fullPath, this.state.content || "");
					this.state.filePath = file.path;
					this.state.title = file.basename;
					this.lastSavedContent = this.state.content || ""; // 更新最后保存的内容
					
					// 更新标题显示
					const titleEl = titleWrapper.querySelector('.my-sticky-title') as HTMLElement;
					if (titleEl) titleEl.innerText = this.state.title;
					
					this.saveState();
					new Notice(`[成功] 已保存为: ${fullPath}`);
				} catch (error) {
					console.error('保存便签失败:', error);
					new Notice(`[错误] 保存失败: ${error}`);
				}
			});
			modal.open();
		};

		closeBtn.onclick = () => {
			// 检查是否需要提示保存
			// 1. 如果没有关联文件（新便签或抽出的内容），且有内容，则提示保存
			// 2. 如果有关联文件，检查是否有未保存的更改
			const currentContent = this.state.isEditing ? this.textareaEl.value : this.state.content;
			const hasContent = (currentContent || "").trim().length > 0;
			const hasUnsavedChanges = currentContent !== this.lastSavedContent;
			
			// 需要提示的情况：
			// - 没有关联文件且有内容（新便签/抽出的内容）
			// - 有关联文件但有未保存的更改
			const shouldPrompt = (!this.state.filePath && hasContent) || (this.state.filePath && hasUnsavedChanges);
			
			if (shouldPrompt) {
				// 弹出确认对话框
				const modal = new ConfirmCloseModal(this.app, async (shouldSave: boolean) => {
					if (shouldSave) {
						// 用户选择保存
						if (this.state.isEditing) {
							this.state.content = this.textareaEl.value;
						}
						
						// 如果已经关联了文件，直接保存
						if (this.state.filePath) {
							const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
							if (file instanceof TFile) {
								await this.app.vault.modify(file, this.state.content || "");
								new Notice("[成功] 便签已保存");
							}
							this.close();
						} else {
							// 新便签，弹出保存对话框
							const saveModal = new SaveStickyNoteModal(this.app, this.plugin, async (fileName: string, folderPath: string) => {
								try {
									if (!fileName.endsWith('.md')) {
										fileName += '.md';
									}
									const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
									if (this.app.vault.getAbstractFileByPath(fullPath)) {
										new Notice(`[错误] 文件已存在: ${fullPath}`);
										return;
									}
									await this.app.vault.create(fullPath, this.state.content || "");
									new Notice(`[成功] 已保存为: ${fullPath}`);
									this.close();
								} catch (error) {
									console.error('保存便签失败:', error);
									new Notice(`[错误] 保存失败: ${error}`);
								}
							});
							saveModal.open();
						}
					} else {
						// 用户选择不保存，直接关闭
						this.close();
					}
				});
				modal.open();
			} else {
				// 不需要提示，直接关闭
				this.close();
			}
		};
	}

	updateVisuals() {
		this.containerEl.setCssStyles({ top: this.state.top });
		this.containerEl.setCssStyles({ left: this.state.left });
		this.containerEl.setCssStyles({ width: this.state.width });
		this.containerEl.setCssStyles({ height: this.state.height });
		this.containerEl.setCssStyles({ resize: this.state.isPinned ? 'none' : 'both' });
		this.containerEl.style.setProperty('--sticky-zoom', (this.state.zoomLevel || 1).toString());
		
		const bgWithAlpha = hexToRgba(this.state.color, this.plugin.settings.noteOpacity);
		
		this.containerEl.style.setProperty('--note-bg-color', this.state.color);
		this.containerEl.style.setProperty('--note-bg-color-alpha', bgWithAlpha);
		this.containerEl.style.setProperty('--note-text-color', this.state.textColor || '#2C3E50');
		
		this.containerEl.classList.toggle('is-pinned', this.state.isPinned);
	}

	async renderContent() {
		if (this.state.isEditing) {
			this.contentContainer.setCssStyles({ display: 'none' });
			this.textareaEl.setCssStyles({ display: 'block' });
			
			// 核心修复：如果当前文本框正处于聚焦状态（用户正在输入），不要强行覆盖它的值
			// 否则会打断中文输入法 (IME) 的组合过程
			if (activeDocument.activeElement !== this.textareaEl) {
				const newContent = this.state.content || "";
				if (this.textareaEl.value !== newContent) {
					this.textareaEl.value = newContent;
				}
				// 仅在非聚焦时尝试恢复焦点，避免干扰正常输入循环
				// activeWindow.setTimeout(() => { this.textareaEl.focus(); }, 50);
			}
		} else {
			this.textareaEl.setCssStyles({ display: 'none' });
			this.contentContainer.setCssStyles({ display: 'block' });
			this.contentContainer.empty();
			let text = this.state.content || "";
			if (this.state.filePath) {
				const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
				if (file instanceof TFile) text = await this.app.vault.read(file);
			}
			await MarkdownRenderer.render(this.app, text, this.contentContainer, this.state.filePath || '', this);
		}
	}

	saveState() {
		this.plugin.stickyNoteManager.updateNote(this.state);
		this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes()).catch(err => {
			console.error('[StickyNote] 保存状态失败:', err);
		});
	}

	close() {
		this.plugin.stickyNoteManager.removeNote(this.state.id);
		this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes()).catch(err => {
			console.error('[StickyNote] 移除便签失败:', err);
		});
		this.unload();
	}


	private currentMouseMove: ((e: MouseEvent) => void) | null = null;
	private currentMouseUp: (() => void) | null = null;

	private cleanupDragging() {
		if (this.currentMouseMove) {
			activeDocument.removeEventListener('mousemove', this.currentMouseMove);
			this.currentMouseMove = null;
		}
		if (this.currentMouseUp) {
			activeDocument.removeEventListener('mouseup', this.currentMouseUp);
			this.currentMouseUp = null;
		}
	}

	setupDragging(handle: HTMLElement) {
		let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

		const onMouseMove = (e: MouseEvent) => {
			pos1 = pos3 - e.clientX;
			pos2 = pos4 - e.clientY;
			pos3 = e.clientX;
			pos4 = e.clientY;
			this.state.top  = (this.containerEl.offsetTop  - pos2) + "px";
			this.state.left = (this.containerEl.offsetLeft - pos1) + "px";
			this.containerEl.setCssStyles({ top: this.state.top });
			this.containerEl.setCssStyles({ left: this.state.left });
		};

		const onMouseUp = () => {
			this.cleanupDragging();
			this.saveState();
		};

		// [L-P7] 使用 registerDomEvent 注册 mousedown，这会在组件 unload 时自动清理
		this.registerDomEvent(handle, 'mousedown', (e: MouseEvent) => {
			if (this.state.isPinned) return;
			const target = e.target as HTMLElement;
			if (target.tagName === 'BUTTON' || target.closest('.my-sticky-btn') || target.closest('.my-sticky-close')) return;
			
			pos3 = e.clientX; 
			pos4 = e.clientY;
			
			this.cleanupDragging(); // 先清理旧的（如果有）
			this.currentMouseMove = onMouseMove;
			this.currentMouseUp = onMouseUp;

			activeDocument.addEventListener('mousemove', onMouseMove);
			activeDocument.addEventListener('mouseup', onMouseUp);
		});
	}

	setupResizing() {
		this.resizeObserver = new ResizeObserver(() => {
			if (this.state.isPinned) return;

			// [BUGFIX] 添加 300ms 防抖：ResizeObserver 在用户拖动调整大小时每帧触发一次，
			// 如果每帧都执行 saveState()（内含文件 I/O）会导致每秒最高 60 次文件写入。
			if (this.resizeTimer !== null) {
				activeWindow.clearTimeout(this.resizeTimer);
			}
			this.resizeTimer = activeWindow.setTimeout(() => {
				this.resizeTimer = null;

				// 如果元素当前被隐藏（如在沉浸模式下），不保存 0x0 的尺寸
				const width  = this.containerEl.style.width;
				const height = this.containerEl.style.height;
				if (width && width !== '0px' && height && height !== '0px') {
					this.state.width  = width;
					this.state.height = height;
					this.saveState();
				}
			}, 300);
		});
		this.resizeObserver.observe(this.containerEl);
	}

}
