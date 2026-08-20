import type { App, TFile } from 'obsidian';
import { Menu, Notice, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import { CORKBOARD_STATUS_MAP, getCorkboardStatusKeys, getCorkboardStatusText } from '../../i18n/data-keys';
import type { ParsedForeshadowingEntry } from '../../types/foreshadowing';
import { renderForeshadowingBadges, renderLoreBadges } from '../../utils/badge';
import { openFileAndFocus, getLeafForFileNavigation } from '../../utils/leaf';
import { isExcludedFromWordCount } from '../../utils/validation';


export interface ChapterCardOptions {
	draggable?: boolean;
	onSaveStateChange?: (isSaving: boolean) => void;
	currentBookPath?: string;
	maxLoreLines?: number;
}

export class ChapterCard {
	static render(
		grid: HTMLElement,
		file: TFile,
		app: App,
		plugin: WebNovelAssistantPlugin,
		cardForeshadowings: ParsedForeshadowingEntry[] = [],
		options: ChapterCardOptions = {}
	): HTMLElement {
		const { draggable = false, onSaveStateChange, currentBookPath = '', maxLoreLines = 2 } = options;

		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		// 优先取 synopsis，其次取 摘要，再取首字母大写的版本
		const synopsis = (frontmatter?.synopsis || frontmatter?.Synopsis || frontmatter?.['摘要'] || '') as string;
		// 状态（通过映射表解析中文旧值与英文新值，向后兼容，包括首字母大写）
		const rawStatus = (frontmatter?.status || frontmatter?.Status || frontmatter?.['状态'] || 'unwritten') as string;
		let status = CORKBOARD_STATUS_MAP[rawStatus] ?? rawStatus;

		const card = grid.createDiv('wn-corkboard-card');
		card.setAttribute('data-path', file.path);
		card.setAttribute('data-basename', file.basename);

		if (draggable) {
			card.setAttribute('draggable', 'true');
			card.addEventListener('dragstart', (e) => {
				e.stopPropagation();
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'all';
					e.dataTransfer.setData('application/wn-chapter-path', file.path);
					e.dataTransfer.setData('text/plain', file.path);
				}
				window.setTimeout(() => card.addClass('is-dragging'), 0);
			});
			card.addEventListener('dragend', () => {
				card.removeClass('is-dragging');
			});
		}

		const cardHeader = card.createDiv('wn-corkboard-card-header');
		const titleContainer = cardHeader.createDiv('wn-corkboard-card-title-container');

		const titleEl = titleContainer.createDiv('wn-corkboard-card-title');
		titleEl.setText(file.basename);

		const editIcon = titleContainer.createDiv('wn-corkboard-card-title-edit');
		setIcon(editIcon, 'pencil');

		titleEl.onclick = () => {
			void (async () => {
				const targetLeaf = getLeafForFileNavigation(app, file);
				await openFileAndFocus(app, targetLeaf, file);
			})();
		};

		const startEdit = () => {
			this.enableTitleEdit(titleContainer, titleEl, editIcon, file, app, onSaveStateChange);
		};
		editIcon.onclick = startEdit;

		const statusEl = cardHeader.createDiv('wn-corkboard-card-status');
		statusEl.setText(getCorkboardStatusText(status));
		statusEl.setCssProps({ cursor: 'pointer' });
		statusEl.title = t('corkboard.click-to-change-status');

		statusEl.onclick = (evt: MouseEvent) => {
			const menu = new Menu();
			const statusKeys = getCorkboardStatusKeys();
			for (const s of statusKeys) {
				menu.addItem((item) => {
					item.setTitle(getCorkboardStatusText(s))
						.setChecked(s === status)
						.onClick(async () => {
							try {
								if (onSaveStateChange) onSaveStateChange(true);
								await app.fileManager.processFrontMatter(file, (fm) => {
									(fm as Record<string, unknown>)['status'] = getCorkboardStatusText(s);
								});
								status = s;
								statusEl.setText(getCorkboardStatusText(s));
								new Notice(t('corkboard.status-updated', { status: getCorkboardStatusText(s) }));
							} catch (err) {
								console.error(err);
								new Notice(t('corkboard.status-update-failed'));
							} finally {
								window.setTimeout(() => {
									if (onSaveStateChange) onSaveStateChange(false);
								}, 500);
							}
						});
				});
			}
			menu.showAtMouseEvent(evt);
		};

		// 内容区：大纲摘要（点击编辑）
		const contentEl = card.createDiv('wn-corkboard-card-content');
		const textEl = contentEl.createDiv('wn-corkboard-card-text');

		if (synopsis.trim() === '') {
			textEl.setText(t('common.click-add-synopsis'));
			textEl.addClass('is-empty');
		} else {
			textEl.setText(synopsis);
		}

		// 悬停或者点击时变成 textarea
		contentEl.onclick = () => {
			this.enableInlineEdit(contentEl, textEl, file, app, onSaveStateChange);
		};

		// 底部：字数等元数据及 Badges
		const footerEl = card.createDiv('wn-corkboard-card-footer wn-footer-1-line');

		// Badges Container (Left side)
		const badgesContainer = footerEl.createDiv('wn-corkboard-card-badges');

		// 1. 伏笔 Badge (待回收/已回收)
		renderForeshadowingBadges(badgesContainer, cardForeshadowings, file.basename, plugin);

		// 2. 设定关联 Badge
		const loreArray: unknown = frontmatter?.lore;
		const bookPath = currentBookPath === '/' ? '' : currentBookPath;
		renderLoreBadges(badgesContainer, loreArray, bookPath, plugin, true, maxLoreLines);

		// 3. 设定 Badge 已自动进入 badge.ts 中的单帧 Batch 批处理队列，无需在每个卡片单独派发 RAF

		// 右键卡片菜单
		card.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			const menu = new Menu();
			const latestCache = app.metadataCache.getFileCache(file);
			const currentExcluded = isExcludedFromWordCount(latestCache?.frontmatter);

			menu.addItem((item) => {
				item.setTitle(currentExcluded ? t('menu.include-in-wordcount') : t('menu.exclude-from-wordcount'))
					.setIcon(currentExcluded ? 'calculator' : 'eye-off')
					.onClick(async () => {
						try {
							if (onSaveStateChange) onSaveStateChange(true);
							await plugin.menuManager.toggleExcludeFromWordCount(file);
						} finally {
							if (onSaveStateChange) onSaveStateChange(false);
						}
					});
			});

			app.workspace.trigger('file-menu', menu, file);
			menu.showAtMouseEvent(e);
		});

		// 字数 (Right side)
		const wordCountEl = footerEl.createDiv('wn-corkboard-card-word-count');
		const isExcluded = isExcludedFromWordCount(frontmatter);
		if (isExcluded) {
			wordCountEl.addClass('is-excluded');
			wordCountEl.createSpan({ cls: 'wn-word-count-num', text: t('corkboard.wordcount-excluded') });
			wordCountEl.title = t('corkboard.wordcount-excluded-tooltip');
		} else {
			const updateWordCountDisplay = (countVal: number | string) => {
				wordCountEl.empty();
				wordCountEl.createSpan({ cls: 'wn-word-count-num', text: String(countVal) });
				wordCountEl.createSpan({ cls: 'wn-word-count-unit', text: t('common.word-char') });
			};

			// 获取精准字数统计
			const cachedCount = plugin.cacheManager.getFileCache(file.path);
			if (cachedCount !== null && cachedCount > 0) {
				updateWordCountDisplay(cachedCount);
			} else {
				wordCountEl.setText(`...`);
				void app.vault.cachedRead(file).then(content => {
					if (!wordCountEl.isConnected) return;
					const count = plugin.calculateAccurateWords(content);
					updateWordCountDisplay(count);
				}).catch(err => console.error("[ChapterCard] cachedRead failed:", err));
			}
		}

		return card;
	}

	private static enableInlineEdit(container: HTMLElement, textEl: HTMLElement, file: TFile, app: App, onSaveStateChange?: (isSaving: boolean) => void): void {
		// 如果已经在编辑中，避免重复创建
		if (container.querySelector('textarea')) return;

		textEl.hide();

		const textarea = container.createEl('textarea', {
			cls: 'wn-corkboard-textarea'
		});
		const currentSynopsis = textEl.hasClass('is-empty') ? '' : textEl.innerText;
		textarea.value = currentSynopsis;

		// 自动聚焦并选中末尾
		textarea.focus();
		textarea.setSelectionRange(currentSynopsis.length, currentSynopsis.length);

		// 自适应高度
		textarea.setCssProps({ height: 'auto' });
		textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
		textarea.oninput = () => {
			textarea.setCssProps({ height: 'auto' });
			textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
		};

		let isSaving = false;
		const saveChanges = async () => {
			if (isSaving) return;
			isSaving = true;
			const newValue = textarea.value.trim();
			if (newValue !== currentSynopsis) {
				textEl.setText(newValue || t('common.click-add-synopsis'));
				textEl.toggleClass('is-empty', newValue === '');

				// 保存到 Markdown 属性中
				try {
					if (onSaveStateChange) onSaveStateChange(true);
					await app.fileManager.processFrontMatter(file, (fm) => {
						// 默认使用 synopsis 字段
						(fm as Record<string, unknown>)['synopsis'] = newValue;
					});
					new Notice(t('common.synopsis-saved', { name: file.basename }));
				} catch (err) {
					console.error(err);
					new Notice(t('corkboard.synopsis-save-failed'));
				} finally {
					window.setTimeout(() => {
						if (onSaveStateChange) onSaveStateChange(false);
					}, 500);
				}
			}

			textarea.remove();
			textEl.show();
		};

		// 失去焦点时保存
		textarea.onblur = () => {
			void saveChanges();
		};

		// 按 Ctrl+Enter 或者直接在空旷处点击也可以保存
		textarea.onkeydown = (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				textarea.blur(); // 触发 onblur 保存
			}
			if (e.key === 'Escape') {
				// 取消修改
				textarea.value = currentSynopsis;
				textarea.blur();
			}
		};
	}

	private static enableTitleEdit(container: HTMLElement, titleEl: HTMLElement, editIcon: HTMLElement, file: TFile, app: App, onSaveStateChange?: (isSaving: boolean) => void): void {
		// 如果已经在编辑中，避免重复创建
		if (container.querySelector('input')) return;

		titleEl.hide();
		editIcon.hide();

		const input = container.createEl('input', {
			type: 'text',
			cls: 'wn-corkboard-title-input'
		});
		input.value = file.basename;

		// 继承样式
		input.setCssProps({
			border: 'none',
			background: 'transparent',
			outline: 'none',
			fontWeight: '600',
			fontSize: '1.05em',
			color: 'var(--text-normal)',
			padding: '0',
			width: '100%',
			minWidth: '50px'
		});

		// 自动聚焦并全选
		input.focus();
		input.select();

		let isSaving = false;
		const saveChanges = async () => {
			if (isSaving) return;
			isSaving = true;
			const newTitle = input.value.trim();

			// 取消或者没改变
			if (!newTitle || newTitle === file.basename) {
				input.remove();
				titleEl.show();
				editIcon.show();
				return;
			}

			// 检查非法字符
			const illegalChars = /[\\/:*?"<>|]/g;
			if (illegalChars.test(newTitle)) {
				new Notice(t('corkboard.rename-failed'));
				input.remove();
				titleEl.show();
				editIcon.show();
				return;
			}

			const parentPath = file.parent?.path === '/' ? '' : (file.parent?.path || '');
			const targetPath = parentPath ? `${parentPath}/${newTitle}.md` : `${newTitle}.md`;

			// 检查是否存在同名文件
			const existFile = app.vault.getAbstractFileByPath(targetPath);
			if (existFile) {
				new Notice(t('corkboard.rename-failed'));
				input.remove();
				titleEl.show();
				editIcon.show();
				return;
			}

			input.disabled = true; // 锁定状态，模拟 loading
			input.setCssProps({ opacity: '0.6', cursor: 'not-allowed' });

			try {
				if (onSaveStateChange) onSaveStateChange(true);
				await app.fileManager.renameFile(file, targetPath);

				// 成功后更新 DOM
				titleEl.setText(newTitle);
				new Notice(t('corkboard.rename-success'));
			} catch (err) {
				console.error("[ChapterCard] rename failed:", err);
				new Notice(t('corkboard.rename-failed'));
			} finally {
				input.remove();
				titleEl.show();
				editIcon.show();
				// 延迟释放锁定，防止触发全局的 rename 事件刷新
				window.setTimeout(() => {
					if (onSaveStateChange) onSaveStateChange(false);
				}, 500);
			}
		};

		// 失去焦点时保存
		input.onblur = () => {
			void saveChanges();
		};

		input.onkeydown = (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			}
			if (e.key === 'Escape') {
				input.value = file.basename;
				input.blur();
			}
		};
	}
}
