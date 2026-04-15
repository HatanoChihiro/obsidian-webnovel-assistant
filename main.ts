import { App, Plugin, PluginSettingTab, Setting, MarkdownView, Modal, TFile, Notice, TFolder, MarkdownRenderer, Component, setIcon, ItemView, WorkspaceLeaf, Platform } from 'obsidian';

export const STATUS_VIEW_TYPE = "writing-status-view";

interface DailyStat {
	focusMs: number;
	slackMs: number;
	addedWords: number;
}

interface ThemeScheme {
	bg: string;
	text: string;
}

interface StickyNoteState {
	id: string;
	filePath?: string;
	content?: string;
	title?: string;
	top: string;
	left: string;
	width: string;
	height: string;
	color: string;      
	textColor?: string; 
	isEditing: boolean;
	isPinned?: boolean; 
	zoomLevel?: number;
}

interface AccurateCountSettings {
	defaultGoal: number;
	showGoal: boolean;
	showExplorerCounts: boolean;
	enableObs: boolean;
	dailyHistory: Record<string, DailyStat>;
	obsPath: string;
	openNotes: StickyNoteState[];
	noteOpacity: number; 
	noteThemes: ThemeScheme[]; 
	idleTimeoutThreshold: number;
}

const DEFAULT_SETTINGS: AccurateCountSettings = {
	defaultGoal: 3000,
	showGoal: true,
	showExplorerCounts: true,
	enableObs: false,
	obsPath: "",
	openNotes: [],
	noteOpacity: 0.9,
	dailyHistory: {},
	idleTimeoutThreshold: 60 * 1000,
	noteThemes: [
		{ bg: '#FDF3B8', text: '#2C3E50' }, // 经典黄
		{ bg: '#FCDDEC', text: '#5D2E46' }, // 樱花粉
		{ bg: '#CCE8CF', text: '#2A4A30' }, // 豆沙绿
		{ bg: '#2C3E50', text: '#F8F9FA' }, // 暗夜蓝
		{ bg: '#E8DFF5', text: '#4A3B69' }, // 薰衣草
		{ bg: '#FDE0C1', text: '#593D2B' }  // 奶茶橘
	]
}

function hexToRgba(hex: string, alpha: number): string {
	if (!hex) return `rgba(255, 255, 255, ${alpha})`;
	let h = hex.replace('#', '');
	if (h.length === 3) h = h.split('').map(c => c + c).join('');
	if (h.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
	let r = parseInt(h.substring(0, 2), 16) || 0;
	let g = parseInt(h.substring(2, 4), 16) || 0;
	let b = parseInt(h.substring(4, 6), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default class AccurateChineseCountPlugin extends Plugin {
	settings!: AccurateCountSettings;
	statusBarItemEl!: HTMLElement;

	isTracking: boolean = false;
	focusMs: number = 0;
	slackMs: number = 0;
	lastTickTime: number = 0;

	sessionAddedWords: number = 0;
	lastFileWords: number = 0; 

	lastEditTime: number = Date.now();
	
	worker: Worker | null = null;
	activeNotes: FloatingStickyNote[] = [];

	async onload() {
		// ==========================================
		// 1. 全平台核心功能 (字数统计、目标、设置页)
		// ==========================================
		await this.loadSettings();
		this.injectGlobalStyles();
		this.statusBarItemEl = this.addStatusBarItem();
		this.addSettingTab(new AccurateCountSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on('editor-change', this.handleEditorChange.bind(this)));
		this.registerEvent(this.app.workspace.on('active-leaf-change', this.handleFileChange.bind(this)));
		this.registerEvent(this.app.metadataCache.on('changed', this.updateWordCount.bind(this)));
		this.updateWordCount(); // 初始化状态栏数字

		// ==========================================
		// 2. 移动端 Lite 模式拦截
		// ==========================================
		if (Platform.isMobile) {
			// 手机端只注册“设定本章目标字数”的右键菜单
			this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					menu.addItem((item) => {
						item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, file).open(); });
					});
				}
			}));
			this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (view.file) {
					menu.addItem((item) => {
						item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, view.file!).open(); });
					});
				}
			}));
			return; // 🛑 关键：手机端执行到这里直接终止，不加载下方的高级重度功能
		}

		// ==========================================
		// 3. 桌面端全功能完全体 (面板、便签、耗电监控等)
		// ==========================================
		this.registerView(STATUS_VIEW_TYPE, (leaf) => new WritingStatusView(leaf, this));

		this.app.workspace.onLayoutReady(() => {
			this.settings.openNotes.forEach(state => {
				const note = new FloatingStickyNote(this.app, this, { state });
				note.load();
			});
			this.refreshFolderCounts();
		});

		this.registerEvent(this.app.vault.on('modify', () => this.refreshFolderCounts()));
		this.registerEvent(this.app.vault.on('delete', () => this.refreshFolderCounts()));
		this.registerEvent(this.app.vault.on('rename', () => this.refreshFolderCounts()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshFolderCounts()));

		this.addRibbonIcon('sticky-note', '新建空白悬浮便签', () => {
			const note = new FloatingStickyNote(this.app, this, { content: '', title: '新便签' });
			note.load();
		});

		this.addRibbonIcon('bar-chart-2', '打开/关闭写作实时状态面板', () => {
			this.toggleStatusView(); 
		});

		this.addCommand({
			id: 'toggle-writing-status-view',
			name: '打开/关闭写作实时状态面板',
			callback: () => this.toggleStatusView()
		});

		this.addCommand({
			id: 'toggle-tracking',
			name: '开始/暂停 码字与时长统计',
			callback: () => {
				this.isTracking = !this.isTracking;
				if (this.isTracking) {
					this.lastTickTime = Date.now();
					this.worker?.postMessage('start');
					new Notice("▶️ 码字时长统计已开始");
				} else {
					this.worker?.postMessage('stop');
					new Notice("⏸️ 码字时长统计已暂停");
				}
				this.updateWordCount();
				this.exportToOBS(true);
				this.refreshStatusViews(); 
			}
		});

		this.addCommand({
			id: 'create-blank-sticky-note',
			name: '新建空白悬浮便签',
			callback: () => {
				const stickyNote = new FloatingStickyNote(this.app, this, { content: '', title: '新便签' });
				stickyNote.load();
			}
		});

		this.addCommand({
			id: 'reset-stream-session',
			name: '重置直播统计数据 (清零时长与今日字数)',
			callback: () => {
				this.focusMs = 0;
				this.slackMs = 0;
				this.sessionAddedWords = 0;
				this.isTracking = false; 
				this.worker?.postMessage('stop');
				this.handleFileChange(); 
				this.exportToOBS(true); 
				this.refreshStatusViews();
				new Notice('直播数据已重置，且统计已暂停，请手动开始新的场次！');
			}
		});

		this.addCommand({
			id: 'create-next-chapter',
			name: '自动生成下一章 (带编号递增)',
			editorCallback: async (editor, view) => {
				const currentFile = view.file;
				if (!currentFile) return;
				const fileName = currentFile.basename; 
				const match = fileName.match(/^([^0-9]*)(\d+)([章节回]?)/);
				if (!match) {
					new Notice("当前文件名不包含数字，无法自动递增！");
					return;
				}
				const prefix = match[1];
				const currentNumStr = match[2];
				const chapterUnit = match[3]; 
				const nextNum = parseInt(currentNumStr, 10) + 1;
				const nextNumStr = nextNum.toString().padStart(currentNumStr.length, '0');
				const newFileName = `${prefix}${nextNumStr}${chapterUnit}.md`;
				const folderPath = currentFile.parent?.path || "/";
				const newFilePath = folderPath === "/" ? newFileName : `${folderPath}/${newFileName}`;

				const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
				if (existingFile) {
					await this.app.workspace.getLeaf(false).openFile(existingFile as TFile);
					return;
				}
				try {
					const newFile = await this.app.vault.create(newFilePath, "");
					await this.app.workspace.getLeaf(false).openFile(newFile);
				} catch (error) { console.error(error); }
			}
		});

		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile && file.extension === 'md') {
				menu.addItem((item) => {
					item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, file).open(); });
				});
				menu.addItem((item) => {
					item.setTitle('作为悬浮便签打开').setIcon('popup-open').onClick(() => { 
						const stickyNote = new FloatingStickyNote(this.app, this, { file: file });
						stickyNote.load(); 
					});
				});
			}

			if (file instanceof TFolder) {
				menu.addItem((item) => {
					item.setTitle('合并导出')
						.setIcon('documents')
						.onClick(async () => {
							const notice = new Notice(`正在扫描并合并《${file.name}》...`, 0);
							const mdFiles: TFile[] = [];
							
							const collectFiles = (folder: TFolder) => {
								for (const child of folder.children) {
									if (child instanceof TFile && child.extension === 'md') {
										mdFiles.push(child);
									} else if (child instanceof TFolder) {
										collectFiles(child);
									}
								}
							};
							collectFiles(file);

							if (mdFiles.length === 0) {
								notice.hide();
								new Notice(`文件夹《${file.name}》中没有找到 Markdown 文件！`);
								return;
							}

							mdFiles.sort((a, b) => a.path.localeCompare(b.path, 'zh', { numeric: true }));

							let mergedContent = `# 【合并导出】${file.name}\n\n`;
							let totalWords = 0;

							for (const mdFile of mdFiles) {
								const content = await this.app.vault.cachedRead(mdFile);
								mergedContent += `\n\n## ${mdFile.basename}\n\n`;
								mergedContent += content;
								totalWords += this.calculateAccurateWords(content);
							}

							let exportPath = `${file.parent?.path === '/' ? '' : file.parent?.path + '/'}${file.name}_合并导出.md`;
							let counter = 1;
							while (this.app.vault.getAbstractFileByPath(exportPath)) {
								exportPath = `${file.parent?.path === '/' ? '' : file.parent?.path + '/'}${file.name}_合并导出(${counter}).md`;
								counter++;
							}

							try {
								const newFile = await this.app.vault.create(exportPath, mergedContent.trim());
								notice.hide();
								await this.app.workspace.getLeaf(false).openFile(newFile);
								new Notice(`✅ 合并成功！\n共合并 ${mdFiles.length} 个文件\n总计 ${totalWords.toLocaleString()} 字`, 8000);
							} catch (error) {
								console.error(error);
								notice.hide();
								new Notice("合并失败，请检查文件权限！");
							}
						});
				});
			}
		}));

		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
			if (editor.somethingSelected()) {
				menu.addItem((item) => {
					item.setTitle('将选中内容抽出为便签').setIcon('quote').onClick(() => { 
						const note = new FloatingStickyNote(this.app, this, { content: editor.getSelection(), title: '选中片段' });
						note.load();
					});
				});
			}
			if (view.file) {
				menu.addItem((item) => {
					item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, view.file!).open(); });
				});
				menu.addItem((item) => {
					item.setTitle('当前文件作为便签抽出').setIcon('popup-open').onClick(() => { 
						const note = new FloatingStickyNote(this.app, this, { file: view.file! });
						note.load();
					});
				});
			}
		}));

		this.setupWorker();

		this.registerInterval(window.setInterval(() => {
			if (this.isTracking) {
				this.saveSettings();
			}
		}, 60 * 1000));
	}
	
	onunload() {
		this.saveSettings();
		this.removeGlobalStyles();
		if (this.worker) this.worker.terminate();
	}

	async toggleStatusView() {
		const { workspace } = this.app;
		// 获取当前所有打开的“状态面板”
		const leaves = workspace.getLeavesOfType(STATUS_VIEW_TYPE);
		
		if (leaves.length > 0) {
			// 1. 如果面板已经存在，就把它们全部关掉 (卸载)
			leaves.forEach(leaf => leaf.detach());
		} else {
			// 2. 如果面板不存在，则在右侧边栏创建并打开
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: STATUS_VIEW_TYPE, active: true });
				workspace.revealLeaf(rightLeaf);
			}
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		
		if (data && data.noteColors && (!data.noteThemes || data.noteThemes.length === 0)) {
			this.settings.noteThemes = data.noteColors.map((c: string) => ({ bg: c, text: '#2C3E50' }));
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	calculateAccurateWords(text: string): number {
		return text.replace(/\s+/g, '').length;
	}

	handleEditorChange() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
        
		this.lastEditTime = Date.now(); 
        
		const currentCount = this.calculateAccurateWords(view.getViewData());
		const delta = currentCount - this.lastFileWords;
		
		this.sessionAddedWords += delta;
		this.lastFileWords = currentCount;

		const today = window.moment().format('YYYY-MM-DD');
		if (!this.settings.dailyHistory[today]) {
			this.settings.dailyHistory[today] = { focusMs: 0, slackMs: 0, addedWords: 0 };
		}
		this.settings.dailyHistory[today].addedWords += delta;

		this.updateWordCount();
		this.refreshStatusViews();
	}

	handleFileChange() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		this.lastFileWords = view ? this.calculateAccurateWords(view.getViewData()) : 0;
		this.updateWordCount();
		this.refreshStatusViews();
	}

	updateWordCount() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { this.statusBarItemEl.setText(''); return; }

		const totalCount = this.calculateAccurateWords(view.getViewData());
		const displaySessionWords = Math.max(0, this.sessionAddedWords);
		
		const stateStr = this.isTracking ? "▶️记录中" : "⏸️已暂停";

		if (this.settings.showGoal && view.file) {
			const cache = this.app.metadataCache.getFileCache(view.file);
			let targetGoal = this.settings.defaultGoal;
			if (cache?.frontmatter && cache.frontmatter['word-goal']) {
				const fmGoal = parseInt(cache.frontmatter['word-goal']);
				if (!isNaN(fmGoal)) targetGoal = fmGoal;
			}

			if (targetGoal > 0) {
				const percent = Math.min(Math.round((totalCount / targetGoal) * 100), 100);
				let emoji = percent >= 100 ? '✅' : '🎯';
				this.statusBarItemEl.setText(`[${stateStr}] ${emoji} 字数: ${totalCount} / ${targetGoal} (${percent}%) | 净增: ${displaySessionWords}`);
				return;
			}
		}

		const cnChars = (view.getViewData().match(/[\u4e00-\u9fa5]/g) || []).length;
		this.statusBarItemEl.setText(`[${stateStr}] 📝 字数: ${totalCount} (纯汉字: ${cnChars}) | 净增: ${displaySessionWords}`);
	}

	setupWorker() {
		const workerCode = `
			let interval;
			self.onmessage = function(e) {
				if (e.data === 'start') {
					clearInterval(interval);
					interval = setInterval(() => self.postMessage('tick'), 1000);
				} else if (e.data === 'stop') {
					clearInterval(interval);
				}
			};
		`;
		const blob = new Blob([workerCode], { type: 'application/javascript' });
		this.worker = new Worker(URL.createObjectURL(blob));
		this.worker.onmessage = () => {
		    if (!this.isTracking) return;
		    const now = Date.now();
		    const delta = now - this.lastTickTime;
		    this.lastTickTime = now;
		    
		    const isAppFocused = document.hasFocus();
		    const isTypingActive = (now - this.lastEditTime) < this.settings.idleTimeoutThreshold;

		    const today = window.moment().format('YYYY-MM-DD');
		    if (!this.settings.dailyHistory[today]) {
		        this.settings.dailyHistory[today] = { focusMs: 0, slackMs: 0, addedWords: 0 };
		    }

		    if (isAppFocused && isTypingActive) {
		        this.focusMs += delta;
		        this.settings.dailyHistory[today].focusMs += delta;
		    } else {
		        this.slackMs += delta;
		        this.settings.dailyHistory[today].slackMs += delta;
		    }
		    
		    this.exportToOBS();
			this.refreshStatusViews(); 
		};
	}

	refreshStatusViews() {
		const leaves = this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof WritingStatusView) {
				leaf.view.updateData();
			}
		}
	}

	formatTime(totalSeconds: number): string {
		const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
		const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
		const s = (totalSeconds % 60).toString().padStart(2, '0');
		return `${h}:${m}:${s}`;
	}

	exportToOBS(force: boolean = false) {
		// --- 增加对移动端的拦截，手机上绝对不执行本地文件写入 ---
		if (!Platform.isDesktop || !this.settings.enableObs || !this.settings.obsPath) return;
		try {
			// @ts-ignore
			const fs = window.require('fs');
			// @ts-ignore
			const path = window.require('path');
			const dir = this.settings.obsPath;
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

			const totalSec = Math.floor((this.focusMs + this.slackMs) / 1000);
			const focusSec = Math.floor(this.focusMs / 1000);
			const slackSec = totalSec - focusSec; 

			fs.writeFileSync(path.join(dir, 'obs_focus_time.txt'), this.formatTime(focusSec), 'utf8');
			fs.writeFileSync(path.join(dir, 'obs_slack_time.txt'), this.formatTime(slackSec), 'utf8');
			fs.writeFileSync(path.join(dir, 'obs_total_time.txt'), this.formatTime(totalSec), 'utf8'); 
			fs.writeFileSync(path.join(dir, 'obs_words_done.txt'), Math.max(0, this.sessionAddedWords).toString(), 'utf8');
			
			let currentGoal = this.settings.defaultGoal;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file) {
				const cache = this.app.metadataCache.getFileCache(view.file);
				const fmGoal = parseInt(cache?.frontmatter?.['word-goal']);
				if (!isNaN(fmGoal)) currentGoal = fmGoal;
			}
			fs.writeFileSync(path.join(dir, 'obs_words_goal.txt'), currentGoal.toString(), 'utf8');
		} catch (e) { if (force) console.error(e); }
	}

	async refreshFolderCounts() {
		const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
		if (!fileExplorer) return;

		const fileExplorerItems = (fileExplorer.view as any).fileItems;

		// --- 如果设置关闭，清除所有已有的字数标签并退出 ---
		if (!this.settings.showExplorerCounts) {
			for (const path in fileExplorerItems) {
				const item = fileExplorerItems[path];
				if (item.el) {
					const countEl = item.el.querySelector('.folder-word-count');
					if (countEl) countEl.remove();
				}
			}
			return;
		}

		// --- 如果设置开启，执行字数统计逻辑 ---
		const counts = new Map<string, number>();
		const allFiles = this.app.vault.getMarkdownFiles();
		
		for (const file of allFiles) {
			const content = await this.app.vault.cachedRead(file);
			const count = this.calculateAccurateWords(content);
			
			// 记录单文件字数
			counts.set(file.path, count);
			
			// 递归累加到所有父文件夹
			let parent = file.parent;
			while (parent) {
				counts.set(parent.path, (counts.get(parent.path) || 0) + count);
				parent = parent.parent;
			}
		}

		for (const path in fileExplorerItems) {
			const item = fileExplorerItems[path];
			// 支持文件夹(TFolder)和文档(TFile)
			if (item.el && (item.file instanceof TFolder || (item.file instanceof TFile && item.file.extension === 'md'))) {
				const count = counts.get(path) || 0;
				let countEl = item.el.querySelector('.folder-word-count');
				
				if (!countEl) {
					// 尝试找到标题容器
					const titleContent = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
					if (titleContent) countEl = titleContent.createEl('span', { cls: 'folder-word-count' });
				}
				
				if (countEl) {
					// 只有字数大于 0 时才显示，或者你可以改为始终显示
					countEl.setText(count > 0 ? ` (${this.formatCount(count)})` : "");
					countEl.style.fontSize = '0.8em';
					countEl.style.opacity = '0.5';
					countEl.style.marginLeft = '5px';
				}
			}
		}
	}

	formatCount(count: number): string {
		if (count >= 10000) return (count / 10000).toFixed(1) + 'w';
		if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
		return count.toString();
	}

	injectGlobalStyles() {
		const styleId = 'accurate-count-global-styles';
		if (!document.getElementById(styleId)) {
			const style = document.createElement('style');
			style.id = styleId;
			style.innerHTML = `
				.folder-word-count { font-variant-numeric: tabular-nums; pointer-events: none; }
				
				/* 侧边栏状态视图样式 */
				.status-view-container { padding: 15px; }
				.status-card { background: var(--background-secondary); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--background-modifier-border); }
				.status-title { font-weight: bold; margin-bottom: 12px; font-size: 1.1em; display: flex; justify-content: space-between; align-items: center; }
				.status-title-badge { font-size: 0.75em; background: var(--interactive-accent); color: var(--text-on-accent); padding: 2px 6px; border-radius: 4px; font-weight: normal; }
				.status-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95em; }
				.status-value { font-family: var(--font-monospace); font-weight: 600; }
				
				.progress-bar-bg { width: 100%; height: 10px; background: var(--background-modifier-border); border-radius: 5px; overflow: hidden; margin: 10px 0; }
				.progress-bar-fill { height: 100%; background: var(--interactive-accent); transition: width 0.3s ease; }
				
				.time-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px; }
				.time-box { background: var(--background-primary); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); }
				.time-box-title { font-size: 0.8em; color: var(--text-muted); margin-bottom: 4px; }
				.time-box-value { font-family: var(--font-monospace); font-size: 1.1em; font-weight: bold; color: var(--text-normal); }
				.time-box.total { grid-column: span 2; background: var(--background-secondary-alt); }
				
				.history-chart { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin-top: 20px; padding-top: 15px; border-top: 1px dashed var(--background-modifier-border); justify-content: space-between;}
				.chart-col { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; }
				.chart-bar { width: 100%; max-width: 20px; background: var(--interactive-accent); border-radius: 3px 3px 0 0; min-height: 2px; transition: height 0.5s ease; opacity: 0.8; cursor: pointer; }
				.chart-bar:hover { opacity: 1; filter: brightness(1.2); }
				.chart-label { font-size: 0.65em; margin-top: 6px; color: var(--text-muted); }

				/* 历史统计大盘 Modal 样式 */
				.history-stats-modal { min-width: 600px; }
				.stats-tab-group { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; }
				.stats-tab-btn { background: transparent; border: none; box-shadow: none; color: var(--text-muted); cursor: pointer; padding: 6px 12px; border-radius: 4px; transition: all 0.2s; }
				.stats-tab-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
				.stats-tab-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: bold; }
				
				.stats-large-chart-container { display: flex; align-items: flex-end; justify-content: space-around; height: 300px; padding: 20px 0 10px 0; border-bottom: 1px dashed var(--background-modifier-border); margin-top: 10px; overflow-x: auto; gap: 8px;}
				.stats-large-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 35px; flex: 1; max-width: 60px; }
				.stats-large-bar { width: 100%; background: var(--interactive-accent); border-radius: 4px 4px 0 0; opacity: 0.8; transition: height 0.4s ease, opacity 0.2s; cursor: crosshair; }
				.stats-large-bar:hover { opacity: 1; filter: brightness(1.2); }
				.stats-large-label { font-size: 0.7em; margin-top: 8px; color: var(--text-muted); white-space: nowrap; }
				.stats-large-value { font-size: 0.75em; margin-top: 4px; font-weight: bold; font-family: var(--font-monospace); }
			`;
			document.head.appendChild(style);
		}
	}

	removeGlobalStyles() {
		const style = document.getElementById('accurate-count-global-styles');
		if (style) style.remove();
	}
}

// ===========================================
// 类：实时状态面板 (ItemView)
// ===========================================
class WritingStatusView extends ItemView {
	plugin: AccurateChineseCountPlugin;
	
	goalWordEl!: HTMLElement;
	todayWordEl!: HTMLElement;
	percentEl!: HTMLElement;
	progressFillEl!: HTMLElement;
	focusTimeEl!: HTMLElement;
	slackTimeEl!: HTMLElement;
	totalTimeEl!: HTMLElement;
	chartContainerEl!: HTMLElement;
	statusBadgeEl!: HTMLElement;

	// 新增统计元素引用
	weekWordEl!: HTMLElement;
	monthWordEl!: HTMLElement;
	yearWordEl!: HTMLElement;
	historyTotalWordEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: AccurateChineseCountPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return STATUS_VIEW_TYPE;
	}

	getDisplayText() {
		return "写作实时状态";
	}

	getIcon() {
		return "bar-chart-2";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('status-view-container');

		// 1. 今日状态卡片
		const goalCard = container.createDiv({ cls: 'status-card' });
		const titleRow = goalCard.createDiv({ cls: 'status-title' });
		titleRow.createSpan({ text: '今日状态' });
		this.statusBadgeEl = titleRow.createSpan({ cls: 'status-title-badge', text: '已暂停' });

		const row1 = goalCard.createDiv({ cls: 'status-row' });
		row1.createSpan({ text: '今日目标' });
		this.goalWordEl = row1.createSpan({ cls: 'status-value', text: '0' });

		const row2 = goalCard.createDiv({ cls: 'status-row' });
		row2.createSpan({ text: '今日已写' });
		this.todayWordEl = row2.createSpan({ cls: 'status-value', text: '0' });

		const progressBg = goalCard.createDiv({ cls: 'progress-bar-bg' });
		this.progressFillEl = progressBg.createDiv({ cls: 'progress-bar-fill' });
		
		const row3 = goalCard.createDiv({ cls: 'status-row', attr: { style: 'justify-content: flex-end; margin-top: 4px;' } });
		this.percentEl = row3.createSpan({ text: '0%', attr: { style: 'font-size: 0.85em; color: var(--text-muted); font-weight: bold;' } });

		// 2. 耗时与历史图表卡片
		const timeCard = container.createDiv({ cls: 'status-card' });
		timeCard.createDiv({ cls: 'status-title', text: '本次统计' });

		const timeGrid = timeCard.createDiv({ cls: 'time-grid' });
		
		const focusBox = timeGrid.createDiv({ cls: 'time-box' });
		focusBox.createDiv({ cls: 'time-box-title', text: '专注时长' });
		this.focusTimeEl = focusBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const slackBox = timeGrid.createDiv({ cls: 'time-box' });
		slackBox.createDiv({ cls: 'time-box-title', text: '摸鱼时长' });
		this.slackTimeEl = slackBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const totalBox = timeGrid.createDiv({ cls: 'time-box total' });
		totalBox.createDiv({ cls: 'time-box-title', text: '总计耗时' });
		this.totalTimeEl = totalBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		this.chartContainerEl = timeCard.createDiv({ cls: 'history-chart' });

		// 3. 历史字数统计卡片 (新增)
		const historyCard = container.createDiv({ cls: 'status-card' });
		historyCard.createDiv({ cls: 'status-title', text: '历史字数统计' });

		const historyGrid = historyCard.createDiv({ cls: 'time-grid' });
		
		const weekBox = historyGrid.createDiv({ cls: 'time-box' });
		weekBox.createDiv({ cls: 'time-box-title', text: '本周净增' });
		this.weekWordEl = weekBox.createDiv({ cls: 'time-box-value', text: '0' });

		const monthBox = historyGrid.createDiv({ cls: 'time-box' });
		monthBox.createDiv({ cls: 'time-box-title', text: '本月净增' });
		this.monthWordEl = monthBox.createDiv({ cls: 'time-box-value', text: '0' });

		const yearBox = historyGrid.createDiv({ cls: 'time-box' });
		yearBox.createDiv({ cls: 'time-box-title', text: '今年净增' });
		this.yearWordEl = yearBox.createDiv({ cls: 'time-box-value', text: '0' });

		const histTotalBox = historyGrid.createDiv({ cls: 'time-box' });
		histTotalBox.createDiv({ cls: 'time-box-title', text: '累计总字数' });
		this.historyTotalWordEl = histTotalBox.createDiv({ cls: 'time-box-value', text: '0' });

		// 更新数据与图表
		this.updateData();
		this.renderChart();
	}

	updateData() {
		if (!this.goalWordEl) return; 

		if (this.plugin.isTracking) {
			this.statusBadgeEl.innerText = '▶ 记录中';
			this.statusBadgeEl.style.background = 'var(--color-green)';
		} else {
			this.statusBadgeEl.innerText = '⏸ 已暂停';
			this.statusBadgeEl.style.background = 'var(--text-muted)';
		}

		let targetGoal = this.plugin.settings.defaultGoal;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			const cache = this.plugin.app.metadataCache.getFileCache(view.file);
			const fmGoal = parseInt(cache?.frontmatter?.['word-goal']);
			if (!isNaN(fmGoal)) targetGoal = fmGoal;
		}

		const today = window.moment().format('YYYY-MM-DD');
		const todayStat = this.plugin.settings.dailyHistory[today] || { focusMs: 0, slackMs: 0, addedWords: 0 };
		const added = Math.max(0, todayStat.addedWords);

		this.goalWordEl.innerText = targetGoal.toString();
		this.todayWordEl.innerText = added.toString();

		const percent = targetGoal > 0 ? Math.min(Math.round((added / targetGoal) * 100), 100) : 0;
		this.percentEl.innerText = `${percent}%`;
		this.progressFillEl.style.width = `${percent}%`;
		if (percent >= 100) {
			this.progressFillEl.style.background = 'var(--color-green)';
		} else {
			this.progressFillEl.style.background = 'var(--interactive-accent)';
		}

		const focusSec = Math.floor(this.plugin.focusMs / 1000);
		const slackSec = Math.floor(this.plugin.slackMs / 1000);
		const totalSec = focusSec + slackSec;

		this.focusTimeEl.innerText = this.plugin.formatTime(focusSec);
		this.slackTimeEl.innerText = this.plugin.formatTime(slackSec);
		this.totalTimeEl.innerText = this.plugin.formatTime(totalSec);

		// 计算历史统计数据 (周/月/年/总计)
		let weekWords = 0;
		let monthWords = 0;
		let yearWords = 0;
		let totalWords = 0;
		
		const now = window.moment();

		for (const [dateStr, stat] of Object.entries(this.plugin.settings.dailyHistory)) {
			const dailyAdded = stat.addedWords || 0;
			totalWords += dailyAdded;
			
			const dateMoment = window.moment(dateStr);
			if (dateMoment.isSame(now, 'isoWeek')) weekWords += dailyAdded;
			if (dateMoment.isSame(now, 'month')) monthWords += dailyAdded;
			if (dateMoment.isSame(now, 'year')) yearWords += dailyAdded;
		}

		// 使用 toLocaleString 添加千位分隔符方便阅读，并且限制最低为 0
		if (this.weekWordEl) this.weekWordEl.innerText = Math.max(0, weekWords).toLocaleString();
		if (this.monthWordEl) this.monthWordEl.innerText = Math.max(0, monthWords).toLocaleString();
		if (this.yearWordEl) this.yearWordEl.innerText = Math.max(0, yearWords).toLocaleString();
		if (this.historyTotalWordEl) this.historyTotalWordEl.innerText = Math.max(0, totalWords).toLocaleString();
	}

	renderChart() {
		this.chartContainerEl.empty();
		
		// 新增：让整个图表区变成可点击的按钮效果
		this.chartContainerEl.style.cursor = 'pointer';
		this.chartContainerEl.setAttribute('aria-label', '点击查看详细历史统计大盘');
		this.chartContainerEl.onclick = () => {
			new HistoryStatsModal(this.plugin.app, this.plugin.settings.dailyHistory).open();
		};

		const history = this.plugin.settings.dailyHistory;
		const dates = Object.keys(history).sort().slice(-7);

		if (dates.length === 0) {
			this.chartContainerEl.createDiv({ text: '暂无历史数据', attr: { style: 'color: var(--text-muted); font-size: 0.8em; margin: auto;' } });
			return;
		}

		const maxWords = Math.max(...dates.map(d => history[d].addedWords), 100); 

		dates.forEach(date => {
			const stat = history[date];
			const col = this.chartContainerEl.createDiv({ cls: 'chart-col' });
			
			const barHeightPercent = Math.max(2, (Math.max(0, stat.addedWords) / maxWords) * 100);
			
			const bar = col.createDiv({ cls: 'chart-bar' });
			bar.style.height = `${barHeightPercent}%`;
			
			const focusHours = (stat.focusMs / 3600000).toFixed(1);
			bar.setAttribute('title', `日期: ${date}\n字数: ${Math.max(0, stat.addedWords)}\n专注时长: ${focusHours}h`);
			
			const dateStr = date.substring(5);
			col.createDiv({ cls: 'chart-label', text: dateStr });
		});
	}

	async onClose() {}
}


// ===========================================
// 类：目标设定弹窗
// ===========================================
class GoalModal extends Modal {
	file: TFile;
	goalInput: string = "";

	constructor(app: App, file: TFile) {
		super(app);
		this.file = file;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.createEl('h2', {text: `为《${this.file.basename}》设定目标`});

		new Setting(contentEl)
			.setName('目标字数')
			.setDesc('输入 0 或清空则恢复全局默认目标。')
			.addText(text => {
				const cache = this.app.metadataCache.getFileCache(this.file);
				if (cache?.frontmatter && cache.frontmatter['word-goal']) {
					text.setValue(cache.frontmatter['word-goal'].toString());
				}
				text.inputEl.focus();
				text.onChange(value => { this.goalInput = value; });
				text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.saveGoal(); });
			});

		new Setting(contentEl).addButton(btn => btn.setButtonText('保存').setCta().onClick(() => { this.saveGoal(); }));
	}

	async saveGoal() {
		const goalNum = parseInt(this.goalInput);
		await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
			if (isNaN(goalNum) || goalNum <= 0) delete frontmatter['word-goal'];
			else frontmatter['word-goal'] = goalNum;
		});
		this.close();
	}
	onClose() { this.contentEl.empty(); }
}

// ===========================================
// 类：设置面板
// ===========================================
class AccurateCountSettingTab extends PluginSettingTab {
	plugin: AccurateChineseCountPlugin;

	constructor(app: App, plugin: AccurateChineseCountPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: '精准字数与目标设置'});

		new Setting(containerEl)
			.setName('显示目标进度')
			.setDesc('在状态栏显示当前文件的字数完成进度。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showGoal)
				.onChange(async (value) => {
					this.plugin.settings.showGoal = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示文件列表字数')
			.setDesc('在侧边栏文件树中显示文件夹和文档的汇总字数。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showExplorerCounts)
				.onChange(async (value) => {
					this.plugin.settings.showExplorerCounts = value;
					await this.plugin.saveSettings();
					// 切换开关时立即刷新一次显示
					this.plugin.refreshFolderCounts();
				}));

		new Setting(containerEl)
			.setName('默认字数目标 (全局)')
			.addText(text => text
				.setValue(this.plugin.settings.defaultGoal.toString())
				.onChange(async (value) => {
					const parsed = parseInt(value);
					if (!isNaN(parsed)) {
						this.plugin.settings.defaultGoal = parsed;
						await this.plugin.saveSettings();
					}
				}));

		containerEl.createEl('h2', {text: '悬浮便签设置'});
		
		new Setting(containerEl)
			.setName('闲置时透明度 (仅背景)')
			.setDesc('调节便签在闲置时的纯背景透明度。拖动滑块时已打开的便签会实时预览！')
			.addSlider(slider => slider
				.setLimits(0.1, 1, 0.05)
				.setValue(this.plugin.settings.noteOpacity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.noteOpacity = value;
					await this.plugin.saveSettings();
					this.plugin.activeNotes.forEach(note => note.updateVisuals());
				}));

		const colorSetting = new Setting(containerEl)
			.setName('自定义主题方案 (背景色 + 文字色)')
			.setDesc('自定义便签调色板中的 6 种预设组合。左侧为背景色，右侧为对应的文字/图标色。');
		
		const colorContainer = colorSetting.controlEl.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;' } });
		
		this.plugin.settings.noteThemes.forEach((theme, index) => {
			const themeDiv = colorContainer.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px; background: var(--background-modifier-form-field); padding: 4px 8px; border-radius: 6px;' } });
			
			const bgInput = themeDiv.createEl('input', { type: 'color', value: theme.bg });
			bgInput.style.cursor = 'pointer'; bgInput.style.border = 'none'; bgInput.style.padding = '0'; bgInput.style.width = '24px'; bgInput.style.height = '24px'; bgInput.style.borderRadius = '4px';
			
			themeDiv.createSpan({ text: 'Aa', attr: { style: 'font-weight: bold; font-family: serif; color: var(--text-muted); padding-left: 2px;' } });
			
			const textInput = themeDiv.createEl('input', { type: 'color', value: theme.text });
			textInput.style.cursor = 'pointer'; textInput.style.border = 'none'; textInput.style.padding = '0'; textInput.style.width = '24px'; textInput.style.height = '24px'; textInput.style.borderRadius = '4px';

			bgInput.onchange = async (e) => {
				this.plugin.settings.noteThemes[index].bg = (e.target as HTMLInputElement).value;
				await this.plugin.saveSettings();
			};
			textInput.onchange = async (e) => {
				this.plugin.settings.noteThemes[index].text = (e.target as HTMLInputElement).value;
				await this.plugin.saveSettings();
			};
		});

		containerEl.createEl('h2', {text: '数据统计与输出设置'});

		new Setting(containerEl)
		    .setName('精准专注度判定阈值 (秒)') 
		    .setDesc('在此时间内没有键盘输入，即使软件处于聚焦状态，也会被判定为“摸鱼”。')
		    .addSlider(slider => slider
		        .setLimits(30, 600, 30) 
		        .setValue(this.plugin.settings.idleTimeoutThreshold / 1000)
		        .setDynamicTooltip()
		        .onChange(async (value) => {
		            this.plugin.settings.idleTimeoutThreshold = value * 1000;
		            await this.plugin.saveSettings();
		        })); 

		new Setting(containerEl)
			.setName('启用直播数据导出')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableObs)
				.onChange(async (value) => {
					this.plugin.settings.enableObs = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('数据输出路径 (绝对路径)')
			.addText(text => text
				.setPlaceholder('请输入文件夹路径')
				.setValue(this.plugin.settings.obsPath)
				.onChange(async (value) => {
					this.plugin.settings.obsPath = value;
					await this.plugin.saveSettings();
				}));
	}
}

// ===========================================
// 类：持久化悬浮便签组件
// ===========================================
class FloatingStickyNote extends Component {
	app: App;
	plugin: AccurateChineseCountPlugin;
	state: StickyNoteState;
	containerEl!: HTMLElement;
	contentContainer!: HTMLDivElement;
	textareaEl!: HTMLTextAreaElement;

	constructor(app: App, plugin: AccurateChineseCountPlugin, options: { file?: TFile, content?: string, title?: string, state?: StickyNoteState }) {
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

		this.updateVisuals();

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

		const headerEl = this.containerEl.createDiv({ cls: 'my-sticky-header' });
		
		const titleWrapper = headerEl.createDiv({ cls: 'my-sticky-title-wrapper' });
		const titleIcon = titleWrapper.createSpan({ cls: 'my-sticky-title-icon' });
		setIcon(titleIcon, 'sticky-note');
		titleWrapper.createSpan({ text: this.state.title || '', cls: 'my-sticky-title' });
		
		const controlsEl = headerEl.createDiv({ cls: 'my-sticky-controls' });
		
		const pinBtn = controlsEl.createEl('button', { cls: 'my-sticky-btn' });
		setIcon(pinBtn, 'pin');
		if (this.state.isPinned) pinBtn.classList.add('is-active');
		
		const saveBtn = controlsEl.createEl('button', { cls: 'my-sticky-btn' });
		setIcon(saveBtn, 'save');

		const toggleEditBtn = controlsEl.createEl('button', { cls: 'my-sticky-btn' });
		setIcon(toggleEditBtn, this.state.isEditing ? 'eye' : 'pencil');

		const paletteBtn = controlsEl.createEl('button', { cls: 'my-sticky-btn palette-btn-target' });
		setIcon(paletteBtn, 'palette');

		const closeBtn = controlsEl.createEl('button', { cls: 'my-sticky-close' });
		setIcon(closeBtn, 'x');

		this.contentContainer = this.containerEl.createDiv({ cls: 'my-sticky-content markdown-rendered' });
		this.textareaEl = this.containerEl.createEl('textarea', { cls: 'my-sticky-textarea' });

		const popupEl = controlsEl.createDiv({ cls: 'my-sticky-palette-popup' });
		this.plugin.settings.noteThemes.forEach(theme => {
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
			if (!(e.target as HTMLElement).closest('.my-sticky-palette-popup') && !(e.target as HTMLElement).closest('.palette-btn-target')) {
				popupEl.classList.remove('is-active');
			}
		});

		paletteBtn.onclick = (e) => { e.stopPropagation(); popupEl.classList.toggle('is-active'); };

		pinBtn.onclick = () => {
			this.state.isPinned = !this.state.isPinned;
			if (this.state.isPinned) {
				pinBtn.classList.add('is-active');
			} else {
				pinBtn.classList.remove('is-active');
			}
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
		};

		saveBtn.onclick = async () => {
			if (this.state.isEditing) {
				this.state.content = this.textareaEl.value;
			}
			if (this.state.filePath) { 
				const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
				if (file instanceof TFile) {
					await this.app.vault.modify(file, this.state.content || "");
					new Notice("✅ 便签已同步至原文档");
				}
				return; 
			}
			const fileName = `便签_${window.moment().format('YYYYMMDD_HHmmss')}.md`;
			const file = await this.app.vault.create(fileName, this.state.content || "");
			this.state.filePath = file.path;
			this.state.title = file.basename;
			const titleEl = titleWrapper.querySelector('.my-sticky-title') as HTMLElement;
			if (titleEl) titleEl.innerText = this.state.title;
			this.saveState();
			new Notice("✅ 已转存为文件");
		};

		closeBtn.onclick = () => this.unload();

		await this.renderContent();
		this.setupDragging(headerEl);
		this.setupResizing();
		
		if (!this.plugin.settings.openNotes.find(n => n.id === this.state.id)) {
			this.plugin.settings.openNotes.push(this.state);
			this.plugin.saveSettings();
		}
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
		
		if (this.state.isPinned) {
			this.containerEl.classList.add('is-pinned');
		} else {
			this.containerEl.classList.remove('is-pinned');
		}
	}

	async renderContent() {
		if (this.state.isEditing) {
			this.contentContainer.style.display = 'none';
			this.textareaEl.style.display = 'block';
			this.textareaEl.value = this.state.content || "";
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
		const index = this.plugin.settings.openNotes.findIndex(n => n.id === this.state.id);
		if (index !== -1) {
			this.plugin.settings.openNotes[index] = this.state;
			this.plugin.saveSettings();
		}
	}

	onunload() {
		if (this.containerEl) {
			this.containerEl.remove();
		}
		const activeIndex = this.plugin.activeNotes.indexOf(this);
		if (activeIndex > -1) {
			this.plugin.activeNotes.splice(activeIndex, 1);
		}
		const stateIndex = this.plugin.settings.openNotes.findIndex(n => n.id === this.state.id);
		if (stateIndex !== -1) {
			this.plugin.settings.openNotes.splice(stateIndex, 1);
			this.plugin.saveSettings();
		}
	}

	setupDragging(handle: HTMLElement) {
		let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
		handle.onmousedown = (e) => {
			if (this.state.isPinned) return; 
			const target = e.target as HTMLElement;
			if (target.tagName === 'BUTTON' || target.closest('.my-sticky-btn') || target.closest('.my-sticky-close')) return;
			pos3 = e.clientX; pos4 = e.clientY;
			document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; this.saveState(); };
			document.onmousemove = (e) => {
				pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
				pos3 = e.clientX; pos4 = e.clientY;
				this.state.top = (this.containerEl.offsetTop - pos2) + "px";
				this.state.left = (this.containerEl.offsetLeft - pos1) + "px";
				this.containerEl.style.top = this.state.top;
				this.containerEl.style.left = this.state.left;
			};
		};
	}

	setupResizing() {
		const observer = new ResizeObserver(() => {
			if (this.state.isPinned) return; 
			this.state.width = this.containerEl.style.width;
			this.state.height = this.containerEl.style.height;
			this.saveState();
		});
		observer.observe(this.containerEl);
	}

	injectCSS() {
		const styleId = 'sticky-note-plugin-styles-v15'; 
		if (!document.getElementById(styleId)) {
			const style = document.createElement('style');
			style.id = styleId;
			style.innerHTML = `
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
				
				.my-sticky-header { padding: 8px 12px; background-color: transparent !important; border-bottom: 1px solid transparent !important; cursor: grab; display: flex; justify-content: space-between; align-items: center; user-select: none; flex-shrink: 0; min-width: 0; transition: background-color 0.2s ease, border-color 0.2s ease; }
				.my-floating-sticky-note:hover .my-sticky-header { background-color: rgba(0, 0, 0, 0.04) !important; border-bottom: 1px solid rgba(0,0,0,0.06) !important; }
				
				.my-sticky-header:active { cursor: grabbing; }
				
				.my-sticky-title-wrapper { display: flex; align-items: center; gap: 6px; overflow: hidden; flex-grow: 1; margin-right: 10px; }
				.my-sticky-title-icon { display: flex; align-items: center; color: var(--note-text-color); opacity: 0.6; }
				.my-sticky-title-icon svg { width: 14px; height: 14px; }
				.my-sticky-title { font-weight: bold; font-size: 0.9em; color: var(--note-text-color) !important; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				
				.my-sticky-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; position: relative; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
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
			document.head.appendChild(style);
		}
	}
}

// ===========================================
// 类：历史统计详细大盘 (Modal)
// ===========================================
class HistoryStatsModal extends Modal {
	history: Record<string, DailyStat>;
	currentTab: 'day' | 'week' | 'month' | 'year' = 'month';
	chartContainer!: HTMLElement;

	constructor(app: App, history: Record<string, DailyStat>) {
		super(app);
		this.history = history;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('history-stats-modal');

		contentEl.createEl('h2', { text: '📈 字数统计' });

		// 创建 Tab 切换组
		const tabGroup = contentEl.createDiv({ cls: 'stats-tab-group' });
		const tabs = [
			{ id: 'day', name: '近30日' },
			{ id: 'week', name: '按周' },
			{ id: 'month', name: '按月' },
			{ id: 'year', name: '按年' }
		];

		tabs.forEach(tab => {
			const btn = tabGroup.createEl('button', { text: tab.name, cls: 'stats-tab-btn' });
			if (this.currentTab === tab.id) btn.addClass('is-active');
			btn.onclick = () => {
				this.currentTab = tab.id as any;
				tabGroup.querySelectorAll('.stats-tab-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.renderData();
			};
		});

		this.chartContainer = contentEl.createDiv({ cls: 'stats-large-chart-container' });
		this.renderData();
	}

	renderData() {
		this.chartContainer.empty();
		const aggregated = this.aggregateData();
		const keys = Object.keys(aggregated).sort();
		
		// 根据 Tab 限制显示数量，防止太挤
		let displayKeys = keys;
		if (this.currentTab === 'day') displayKeys = keys.slice(-30);
		if (this.currentTab === 'week') displayKeys = keys.slice(-12); // 近12周

		if (displayKeys.length === 0) {
			this.chartContainer.createDiv({ text: '暂无数据' });
			return;
		}

		const maxWords = Math.max(...displayKeys.map(k => aggregated[k].words), 100);

		displayKeys.forEach(key => {
			const data = aggregated[key];
			const col = this.chartContainer.createDiv({ cls: 'stats-large-col' });
			
			const heightPercent = Math.max(2, (data.words / maxWords) * 100);
			const bar = col.createDiv({ cls: 'stats-large-bar' });
			bar.style.height = `${heightPercent}%`;
			
			// 悬停提示
			const focusHours = (data.focusMs / 3600000).toFixed(1);
			bar.setAttribute('title', `时间: ${key}\n总字数: ${data.words.toLocaleString()}\n专注总计: ${focusHours}小时`);

			col.createDiv({ cls: 'stats-large-label', text: this.formatLabel(key) });
			col.createDiv({ cls: 'stats-large-value', text: this.formatCount(data.words) });
		});
	}

	aggregateData() {
		const result: Record<string, { words: number, focusMs: number }> = {};
		
		for (const [date, stat] of Object.entries(this.history)) {
			const m = window.moment(date);
			let key = date; // 默认按日

			if (this.currentTab === 'week') {
				key = `${m.year()}年 第${m.isoWeek()}周`;
			} else if (this.currentTab === 'month') {
				key = m.format('YYYY-MM');
			} else if (this.currentTab === 'year') {
				key = m.format('YYYY');
			}

			if (!result[key]) result[key] = { words: 0, focusMs: 0 };
			result[key].words += Math.max(0, stat.addedWords || 0);
			result[key].focusMs += (stat.focusMs || 0);
		}
		return result;
	}

	formatLabel(key: string): string {
		if (this.currentTab === 'day') return key.substring(5); // 04-15
		if (this.currentTab === 'month') return key.substring(2); // 24-04
		return key; // week 和 year 直接显示
	}

	formatCount(count: number): string {
		if (count >= 10000) return (count / 10000).toFixed(1) + 'w';
		if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
		return count.toString();
	}

	onClose() {
		this.contentEl.empty();
	}
}