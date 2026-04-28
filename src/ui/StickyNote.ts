import { App, Component, MarkdownRenderer, Notice, TFile, setIcon, Modal, Setting, MarkdownView } from 'obsidian';
import { StickyNoteState } from '../types/settings';
import { hexToRgba } from '../utils/format';
import { injectGlobalStyle } from '../utils/dom';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 保存便签对话框
 */
class SaveStickyNoteModal extends Modal {
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
				text.setValue(`便签_${window.moment().format('YYYYMMDD_HHmmss')}`)
					.onChange(() => {
						// 实时验证文件名
						const fileName = this.fileNameInput.value.trim();
						if (!fileName) {
							this.fileNameInput.style.borderColor = 'var(--background-modifier-error)';
						} else {
							this.fileNameInput.style.borderColor = '';
						}
					});
				text.inputEl.style.width = '100%';
				
				// 自动选中文件名（不包括时间戳）
				setTimeout(() => {
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
				text.inputEl.style.width = '100%';
			});
		
		// 提示信息
		contentEl.createEl('p', { 
			text: '提示：默认保存到当前工作文件夹',
			cls: 'setting-item-description'
		});
		
		// 按钮
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.marginTop = '20px';
		
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
class ConfirmCloseModal extends Modal {
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
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.marginTop = '20px';
		
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

	constructor(app: App, plugin: WebNovelAssistantPlugin, options: { file?: TFile, content?: string, title?: string, state?: StickyNoteState }) {
		super();
		this.app = app;
		this.plugin = plugin;
		
		if (options.state) {
			this.state = options.state;
			if (!this.state.zoomLevel) this.state.zoomLevel = 1;
			if (!this.state.textColor) this.state.textColor = '#2C3E50'; 
		} else {
			this.state = {
				id: Math.random().toString(36).substring(2, 11),
				filePath: options.file?.path,
				content: options.content || "",
				title: options.title || (options.file ? options.file.basename : "新便签"),
				top: "150px",
				left: "150px",
				width: "320px",
				height: "450px",
				color: this.plugin.settings.noteThemes[0].bg,
				textColor: this.plugin.settings.noteThemes[0].text,
				isEditing: !options.file && !options.content,
				isPinned: false,
				zoomLevel: 1 
			};
		}
		
		// 保存初始内容，用于检测是否有未保存的更改
		this.initialContent = this.state.content || "";
	}

	async onload() {
		this.plugin.activeNotes.push(this);
		
		this.injectCSS();
		this.containerEl = document.body.createDiv({ cls: 'my-floating-sticky-note' });
		
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
		
		if (!this.plugin.settings.openNotes.find((n: StickyNoteState) => n.id === this.state.id)) {
			this.plugin.settings.openNotes.push(this.state);
			this.plugin.saveSettings().catch(err => {
				console.error('[StickyNote] 保存设置失败:', err);
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
			// 获取当前 Obsidian 后台认为的"活动面板"
			const activeLeaf = this.app.workspace.activeLeaf;
			// 如果当前的活动面板不是 Markdown 编辑器（比如停留在了文件浏览器或搜索栏）
			// 此时按下空格/回车会被它们拦截，触发"打开所选文件"的 Bug。
			if (activeLeaf && activeLeaf.view.getViewType() !== 'markdown') {
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

		// 创建调色板弹窗
		const popupEl = this.createPalettePopup(controlsEl);

		// 绑定事件
		this.bindHeaderEvents(pinBtn, saveBtn, toggleEditBtn, paletteBtn, closeBtn, popupEl, titleWrapper);
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
		this.plugin.settings.noteThemes.forEach((theme: any) => {
			const swatch = popupEl.createDiv({ cls: 'my-sticky-swatch' });
			swatch.style.backgroundColor = theme.bg;
			swatch.style.color = theme.text;
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
				requestAnimationFrame(() => {
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
		this.containerEl.style.top = this.state.top;
		this.containerEl.style.left = this.state.left;
		this.containerEl.style.width = this.state.width;
		this.containerEl.style.height = this.state.height;
		this.containerEl.style.resize = this.state.isPinned ? 'none' : 'both';
		this.containerEl.style.setProperty('--sticky-zoom', (this.state.zoomLevel || 1).toString());
		
		const bgWithAlpha = hexToRgba(this.state.color, this.plugin.settings.noteOpacity);
		
		this.containerEl.style.setProperty('--note-bg-color', this.state.color);
		this.containerEl.style.setProperty('--note-bg-color-alpha', bgWithAlpha);
		this.containerEl.style.setProperty('--note-text-color', this.state.textColor || '#2C3E50');
		
		this.containerEl.classList.toggle('is-pinned', this.state.isPinned);
	}

	async renderContent() {
		if (this.state.isEditing) {
			this.contentContainer.style.display = 'none';
			this.textareaEl.style.display = 'block';
			this.textareaEl.value = this.state.content || "";
			// 设置焦点，确保可以正常输入
			// 使用较长的延迟确保 DOM 更新和异步操作完成
			setTimeout(() => {
				this.textareaEl.focus();
			}, 50);
		} else {
			this.textareaEl.style.display = 'none';
			this.contentContainer.style.display = 'block';
			this.contentContainer.empty();
			let text = this.state.content || "";
			if (this.state.filePath) {
				const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
				if (file instanceof TFile) text = await this.app.vault.read(file);
			}
			await MarkdownRenderer.renderMarkdown(text, this.contentContainer, this.state.filePath || '', this);
		}
	}

	saveState() {
		const index = this.plugin.settings.openNotes.findIndex((n: StickyNoteState) => n.id === this.state.id);
		if (index !== -1) {
			this.plugin.settings.openNotes[index] = this.state;
			this.plugin.saveSettings().catch(err => {
				console.error('[StickyNote] 保存状态失败:', err);
			});
		}
	}

	onunload() {
		// 清理 ResizeObserver
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		
		if (this.containerEl) {
			this.containerEl.remove();
		}
		const activeIndex = this.plugin.activeNotes.indexOf(this);
		if (activeIndex > -1) {
			this.plugin.activeNotes.splice(activeIndex, 1);
		}
	}
	
	close() {
		const stateIndex = this.plugin.settings.openNotes.findIndex((n: StickyNoteState) => n.id === this.state.id);
		if (stateIndex !== -1) {
			this.plugin.settings.openNotes.splice(stateIndex, 1);
			this.plugin.saveSettings().catch(err => {
				console.error('[StickyNote] 关闭时保存设置失败:', err);
			});
		}
		this.unload();
	}

	setupDragging(handle: HTMLElement) {
		let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
		handle.onmousedown = (e) => {
			if (this.state.isPinned) return; 
			const target = e.target as HTMLElement;
			if (target.tagName === 'BUTTON' || target.closest('.my-sticky-btn') || target.closest('.my-sticky-close')) return;
			pos3 = e.clientX; pos4 = e.clientY;
			document.onmouseup = () => { 
				document.onmouseup = null; 
				document.onmousemove = null; 
				this.saveState(); 
			};
			document.onmousemove = (e) => {
				pos1 = pos3 - e.clientX; 
				pos2 = pos4 - e.clientY;
				pos3 = e.clientX; 
				pos4 = e.clientY;
				this.state.top = (this.containerEl.offsetTop - pos2) + "px";
				this.state.left = (this.containerEl.offsetLeft - pos1) + "px";
				this.containerEl.style.top = this.state.top;
				this.containerEl.style.left = this.state.left;
			};
		};
	}

	setupResizing() {
		this.resizeObserver = new ResizeObserver(() => {
			if (this.state.isPinned) return; 
			this.state.width = this.containerEl.style.width;
			this.state.height = this.containerEl.style.height;
			this.saveState();
		});
		this.resizeObserver.observe(this.containerEl);
	}

	injectCSS() {
		const styleId = 'sticky-note-plugin-styles-v15'; 
		const styleContent = `
			.my-floating-sticky-note { 
				position: fixed; width: 320px; height: 450px; min-width: 200px; min-height: 200px; 
				border: 1px solid rgba(0,0,0,0.1) !important; 
				box-shadow: 0 10px 30px rgba(0,0,0,0.15); 
				border-radius: 8px; z-index: var(--layer-popover, 40); 
				display: flex; flex-direction: column; overflow: hidden; 
				transition: background-color 0.2s ease, box-shadow 0.3s ease; 
				background-color: var(--note-bg-color-alpha, transparent) !important; 
			}
			
			.my-floating-sticky-note:hover { 
				box-shadow: 0 12px 35px rgba(0,0,0,0.22); 
				background-color: var(--note-bg-color) !important;
			}
			
			.my-sticky-header { 
				padding: 8px 12px; 
				background-color: transparent !important; 
				border-bottom: 1px solid transparent !important; 
				cursor: grab; 
				display: flex; 
				flex-direction: row !important; 
				align-items: center; 
				justify-content: space-between !important; 
				user-select: none; 
				flex-shrink: 0; 
				min-width: 0; 
				transition: background-color 0.2s ease, border-color 0.2s ease; 
				gap: 10px;
			}
			.my-floating-sticky-note:hover .my-sticky-header { background-color: rgba(0, 0, 0, 0.04) !important; border-bottom: 1px solid rgba(0,0,0,0.06) !important; }
			
			.my-sticky-header:active { cursor: grabbing; }
			
			.my-sticky-title-wrapper { 
				display: flex; 
				align-items: center; 
				gap: 6px; 
				overflow: hidden; 
				flex-grow: 1; 
				flex-shrink: 1;
				min-width: 0;
			}
			.my-sticky-title-icon { display: flex; align-items: center; color: var(--note-text-color); opacity: 0.6; flex-shrink: 0; }
			.my-sticky-title-icon svg { width: 14px; height: 14px; }
			.my-sticky-title { font-weight: bold; font-size: 0.9em; color: var(--note-text-color) !important; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; min-width: 0; }
			
			.my-sticky-controls { 
				display: flex; 
				align-items: center; 
				gap: 4px; 
				flex-shrink: 0; 
				position: relative; 
				opacity: 0; 
				pointer-events: none; 
				transition: opacity 0.2s ease; 
			}
			.my-floating-sticky-note:hover .my-sticky-controls { opacity: 1; pointer-events: auto; }
			
			.my-sticky-btn, .my-sticky-close { background: transparent !important; border: none; box-shadow: none; cursor: pointer; padding: 4px; border-radius: 4px; color: var(--note-text-color) !important; opacity: 0.5; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
			.my-sticky-btn svg, .my-sticky-close svg { width: 16px; height: 16px; stroke-width: 2px; }
			.my-sticky-btn:hover { background-color: rgba(0,0,0,0.08) !important; opacity: 1; }
			.my-sticky-btn.is-active { color: var(--interactive-accent) !important; background-color: rgba(0,0,0,0.06) !important; opacity: 1;}
			
			.my-sticky-close:hover { color: #e74c3c !important; background-color: rgba(231, 76, 60, 0.1) !important; opacity: 1;}
			
			.my-sticky-palette-popup { display: none; position: absolute; top: 32px; right: 25px; background-color: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: var(--layer-menu, 50); grid-template-columns: repeat(3, 1fr); gap: 8px; }
			.my-sticky-palette-popup.is-active { display: grid; animation: popupFadeIn 0.15s ease-out; }
			@keyframes popupFadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
			
			.my-sticky-swatch { width: 26px; height: 26px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.15); cursor: pointer; transition: transform 0.1s, border-color 0.1s; display: flex; align-items: center; justify-content: center; font-weight: bold; font-family: serif; font-size: 13px;}
			.my-sticky-swatch:hover { transform: scale(1.15); border-color: rgba(0,0,0,0.5); }
			
			.my-sticky-content { padding: 15px; overflow-y: auto; font-size: calc(0.9em * var(--sticky-zoom, 1)); flex-grow: 1; color: var(--note-text-color) !important; padding-bottom: 25px; background-color: transparent !important; }
			
			.my-sticky-content * { color: inherit; }
			
			.my-sticky-textarea { flex-grow: 1; width: 100%; height: calc(100% - 10px); resize: none; border: none; background: transparent !important; color: var(--note-text-color) !important; font-family: var(--font-text); font-size: calc(0.9em * var(--sticky-zoom, 1)); padding: 15px; outline: none; box-shadow: none; display: none; line-height: 1.5; }
			.my-sticky-textarea:focus { box-shadow: none; background-color: transparent !important; }
			
			.my-sticky-content h1.inline-title { display: none; }
		`;
		injectGlobalStyle(styleId, styleContent);
	}
}
