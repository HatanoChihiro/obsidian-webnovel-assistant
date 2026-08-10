import type { App } from 'obsidian';
import { Modal, Setting, Notice, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { TextSplitter, type ParsedChapter } from '../services/TextSplitter';
import { ChapterSorter } from '../services/ChapterSorter';

export class ImportNovelModal extends Modal {
	plugin: WebNovelAssistantPlugin;
	
	private fileInput!: HTMLInputElement;
	private encodingDropdown!: HTMLSelectElement;
	private previewContainer!: HTMLElement;
	private startButton!: HTMLButtonElement;
	
	private selectedFile: File | null = null;
	private parsedChapters: ParsedChapter[] = [];
	private isImporting: boolean = false;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		new Setting(contentEl).setHeading().setName(t('import-novel.title'));

		// 1. 文件选择
		const fileSetting = new Setting(contentEl)
			.setName(t('import-novel.select-file'));
		fileSetting.settingEl.addClass('wn-import-file-setting');
		
		this.fileInput = fileSetting.controlEl.createEl('input', {
			type: 'file',
			cls: 'wn-import-file-input',
			attr: { accept: '.txt,.md' }
		});
		
		this.fileInput.addEventListener('change', (e) => {
			const target = e.target as HTMLInputElement;
			if (target.files && target.files.length > 0) {
				this.selectedFile = target.files[0];
				this.parseFile();
			} else {
				this.selectedFile = null;
				this.parsedChapters = [];
				this.renderPreview();
			}
		});

		// 2. 编码选择
		new Setting(contentEl)
			.setName(t('import-novel.encoding'))
			.addDropdown(dropdown => {
				this.encodingDropdown = dropdown.selectEl;
				dropdown.addOption('utf-8', t('import-novel.encoding-utf8'));
				dropdown.addOption('gbk', t('import-novel.encoding-gbk'));
				dropdown.onChange(() => {
					if (this.selectedFile) {
						this.parseFile();
					}
				});
			});

		// 3. 预览区域
		new Setting(contentEl).setHeading().setName(t('import-novel.preview'));
		contentEl.createEl('p', { text: t('import-novel.preview-desc'), cls: 'setting-item-description wn-import-preview-desc' });
		
		this.previewContainer = contentEl.createDiv({ cls: 'wn-import-preview' });

		// 4. 按钮容器
		const btnContainer = contentEl.createDiv({ cls: 'wn-base-button-container wn-import-btn-container' });

		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		this.startButton = btnContainer.createEl('button', { 
			text: t('import-novel.start-import'),
			cls: 'mod-cta'
		});
		this.startButton.disabled = true;
		this.startButton.onclick = () => this.startImport();
	}

	private parseFile() {
		const targetFile = this.selectedFile;
		if (!targetFile) return;

		const reader = new FileReader();
		const userEncoding = this.encodingDropdown.value;

		reader.onload = (e) => {
			try {
				const buffer = e.target?.result as ArrayBuffer;
				if (!buffer) return;
				const bytes = new Uint8Array(buffer);

				let text = '';

				// 智能编码识别与自动切流
				if (userEncoding === 'utf-8') {
					const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
					const utf8Text = utf8Decoder.decode(bytes);
					const utf8Errors = (utf8Text.match(/\uFFFD/g) || []).length;

					// 如果 UTF-8 解码发现存在 \uFFFD 替换字符，尝试使用 GBK
					if (utf8Errors > 0) {
						try {
							const gbkDecoder = new TextDecoder('gbk', { fatal: false });
							const gbkText = gbkDecoder.decode(bytes);
							const gbkErrors = (gbkText.match(/\uFFFD/g) || []).length;

							// 如果 GBK 乱码明显减少，自动切为 GBK 编码
							if (gbkErrors < utf8Errors) {
								text = gbkText;
								this.encodingDropdown.value = 'gbk';
								new Notice(t('import-novel.auto-encoding-gbk'));
							} else {
								text = utf8Text;
							}
						} catch {
							text = utf8Text;
						}
					} else {
						text = utf8Text;
					}
				} else {
					try {
						const decoder = new TextDecoder(userEncoding, { fatal: false });
						text = decoder.decode(bytes);
					} catch {
						const fallbackReader = new FileReader();
						fallbackReader.onload = (ev) => {
							const str = ev.target?.result as string;
							ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);
							this.parsedChapters = TextSplitter.splitIntoChapters(str);
							this.renderPreview();
						};
						fallbackReader.readAsText(targetFile, userEncoding);
						return;
					}
				}

				// 在切分前，同步加载最新的章节匹配规则
				ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);
				this.parsedChapters = TextSplitter.splitIntoChapters(text);
				this.renderPreview();
			} catch (err) {
				window.console.error(err);
				new Notice(t('import-novel.error-read', { error: String(err) }));
			}
		};

		reader.onerror = () => {
			new Notice(t('import-novel.error-read', { error: 'FileReader error' }));
		};

		// 以 ArrayBuffer 读取以便进行智能编码检测与 TextDecoder 无损解析
		reader.readAsArrayBuffer(targetFile);
	}

	private removeChapter(index: number) {
		if (index < 0 || index >= this.parsedChapters.length) return;
		const target = this.parsedChapters[index];
		const prologueTitle = t('import-novel.prologue');

		if (index === 0) {
			if (target.title !== prologueTitle) {
				// 若剔除的是首章，且当前标题不是“非章节内容”，将其转换为“非章节内容”并把原标题作为第一段插回正文
				target.content.unshift(target.title);
				target.wordCount += target.title.length;
				target.title = prologueTitle;
			} else if (this.parsedChapters.length > 1) {
				// 若首章已经是“非章节内容”，则将其合并到下一章头部
				const next = this.parsedChapters[1];
				next.content.unshift(...target.content);
				next.wordCount += target.wordCount;
				this.parsedChapters.splice(0, 1);
			}
		} else {
			// 非首章：将本章标题与正文合并入上一章尾部
			const prev = this.parsedChapters[index - 1];
			prev.content.push(target.title, ...target.content);
			prev.wordCount += target.title.length + target.wordCount;
			this.parsedChapters.splice(index, 1);
		}

		this.renderPreview();
	}

	private renderPreview() {
		this.previewContainer.empty();
		
		if (this.parsedChapters.length === 0) {
			this.startButton.disabled = true;
			this.previewContainer.createDiv({ 
				text: t('import-novel.no-preview'), 
				cls: 'text-muted' 
			});
			return;
		}

		this.startButton.disabled = false;
		
		// 顶部统计
		const countDiv = this.previewContainer.createDiv({ cls: 'wn-import-count' });
		countDiv.setText(t('import-novel.total-chapters', { count: String(this.parsedChapters.length) }));

		// 列表展示前 200 章预览
		const displayCount = Math.min(200, this.parsedChapters.length);
		let lastVolume: string | undefined;
		for (let i = 0; i < displayCount; i++) {
			const chap = this.parsedChapters[i];
			if (chap.volume && chap.volume !== lastVolume) {
				this.previewContainer.createDiv({
					text: t('import-novel.volume-label', { name: chap.volume }),
					cls: 'wn-import-volume'
				});
			}
			lastVolume = chap.volume;
			const item = this.previewContainer.createDiv({ cls: 'wn-import-item' });
			
			const infoDiv = item.createDiv({ cls: 'wn-import-item-info' });
			infoDiv.createSpan({ text: chap.title, cls: 'wn-import-item-title' });
			infoDiv.createSpan({ text: t('import-novel.words-suffix', { count: String(chap.wordCount) }), cls: 'wn-import-item-count' });

			const deleteBtn = item.createEl('button', {
				cls: 'wn-import-item-delete',
				attr: { 
					'aria-label': t('import-novel.remove-chapter'),
					'title': t('import-novel.remove-chapter')
				}
			});
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.onclick = (e) => {
				e.stopPropagation();
				this.removeChapter(i);
			};
		}

		if (this.parsedChapters.length > 200) {
			const moreItem = this.previewContainer.createDiv({ cls: 'wn-import-item-more' });
			moreItem.setText(t('import-novel.more-chapters-hidden', { count: String(this.parsedChapters.length - 200) }));
		}
	}

	private async startImport() {
		if (this.isImporting) return;
		if (!this.selectedFile) {
			new Notice(t('import-novel.error-empty'));
			return;
		}
		
		if (this.parsedChapters.length === 0) return;

		this.isImporting = true;
		this.startButton.disabled = true;
		this.fileInput.disabled = true;
		this.encodingDropdown.disabled = true;

		// 去掉后缀名作为小说名
		const novelName = this.selectedFile.name.replace(/\.[^/.]+$/, "");

		try {
			const totalCount = this.parsedChapters.length;
			await TextSplitter.executeImport(
				this.app,
				this.plugin,
				novelName,
				this.parsedChapters,
				(current, total) => {
					this.startButton.setText(t('import-novel.importing', { 
						current: String(current), 
						total: String(total) 
					}));
				}
			);
			new Notice(t('import-novel.success', { count: String(totalCount) }));
			this.close();
		} catch (error) {
			window.console.error(error);
			new Notice(t('import-novel.error-import-failed', { error: String(error) }));
			this.startButton.disabled = false;
			this.startButton.setText(t('import-novel.start-import'));
		} finally {
			this.isImporting = false;
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
