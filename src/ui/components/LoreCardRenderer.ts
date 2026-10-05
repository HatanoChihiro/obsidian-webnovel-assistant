import { MarkdownRenderer, type Component, setIcon, type App, type TFile } from 'obsidian';
import { t } from '../../i18n';
import type { AccurateCountSettings } from '../../types/settings';
import type { CharacterManager, LoreEntry } from '../../services/CharacterManager';
import { cleanLoreHeading } from '../../services/CharacterManager';
import { smartLocateAndHighlight } from '../../utils/leaf';
import { injectSoftBreakIndentPlaceholders } from '../../utils/softBreakIndent';
import { createCardImportanceButton } from './CardImportanceButton';
import { createStickyNoteParagraphEditor, setCaretPosition } from './StickyNoteParagraphEditor';

export interface LoreCardRendererPlugin {
	app: App;
	settings: Pick<AccurateCountSettings, 'lorePopoverCollapse'>;
	characterManager: Pick<CharacterManager, 'getLoreContent' | 'updateLoreContent'> & {
		toggleLoreImportance?: (entry: LoreEntry) => Promise<boolean>;
	};
}

/** 解析后的词条正文：待渲染的 Markdown 片段与提取出的别名列表 */
export interface ResolvedLoreBody {
	/** 已剥离别名声明行与重要标记的 Markdown 正文（不含标题行） */
	chunk: string;
	/** 别名（大纲模式取别名行，单文件模式合并 Frontmatter 与正文别名行） */
	aliases: string[];
}

/** 词条正文解析结果缓存上限（条目数） */
const LORE_BODY_CACHE_LIMIT = 200;

/**
 * 卡片头部动作按钮的统一规格（展开/编辑按钮共用，避免重复类名提权）
 * 独立类名承载尺寸与交互，可访问性属性由调用方补充
 */
export const LORE_CARD_ACTION_BTN_CLASS = 'wn-lore-card-action-btn';
export const LORE_CARD_EDIT_BTN_CLASS = `${LORE_CARD_ACTION_BTN_CLASS} wn-lore-card-edit-btn`;
export const LORE_CARD_EXPAND_BTN_CLASS = `${LORE_CARD_ACTION_BTN_CLASS} wn-lore-card-expand-btn clickable-icon`;

export class LoreCardRenderer {
	private static readonly aliasBadgeCleanups = new WeakMap<HTMLElement, () => void>();

	/**
	 * 词条正文解析缓存：键为 `文件路径\u0000词条标题`。
	 * 命中后可直接复用 Markdown 片段，避免卡片与悬停预览重复读取与解析同一词条。
	 * 以文件修改时间为新鲜度凭据，文件被修改时对应文件的全部缓存立即失效。
	 */
	private static readonly loreBodyCache = new Map<string, { chunk: string; aliases: string[]; mtime: number; file: TFile }>();

	private static getCacheKey(entry: LoreEntry): string {
		return `${entry.file.path}\u0000${entry.heading}`;
	}

	private static getEntryMtime(file: TFile): number {
		return file.stat?.mtime ?? 0;
	}

	/** 清空词条正文解析缓存；传入文件时仅清空该文件的全部词条缓存 */
	static clearLoreBodyCache(file?: TFile): void {
		if (!file) {
			LoreCardRenderer.loreBodyCache.clear();
			return;
		}
		const prefix = `${file.path}\u0000`;
		for (const key of Array.from(LoreCardRenderer.loreBodyCache.keys())) {
			if (key.startsWith(prefix)) LoreCardRenderer.loreBodyCache.delete(key);
		}
	}

	private static readCache(entry: LoreEntry): ResolvedLoreBody | null {
		const key = LoreCardRenderer.getCacheKey(entry);
		const cached = LoreCardRenderer.loreBodyCache.get(key);
		if (!cached) return null;
		if (cached.file !== entry.file || cached.mtime !== LoreCardRenderer.getEntryMtime(entry.file)) {
			LoreCardRenderer.loreBodyCache.delete(key);
			return null;
		}
		// 命中后重新插入，维持 Map 的插入序即最近使用序
		LoreCardRenderer.loreBodyCache.delete(key);
		LoreCardRenderer.loreBodyCache.set(key, cached);
		return { chunk: cached.chunk, aliases: [...cached.aliases] };
	}

	private static writeCache(
		entry: LoreEntry,
		resolved: ResolvedLoreBody,
		expectedMtime: number,
		targetFile: TFile
	): void {
		if (expectedMtime <= 0) return;
		if (entry.file !== targetFile) return;
		if (LoreCardRenderer.getEntryMtime(entry.file) !== expectedMtime) return;

		const key = LoreCardRenderer.getCacheKey(entry);
		LoreCardRenderer.loreBodyCache.delete(key);
		LoreCardRenderer.loreBodyCache.set(key, {
			chunk: resolved.chunk,
			aliases: [...resolved.aliases],
			mtime: expectedMtime,
			file: targetFile
		});
		while (LoreCardRenderer.loreBodyCache.size > LORE_BODY_CACHE_LIMIT) {
			const oldest = LoreCardRenderer.loreBodyCache.keys().next();
			if (oldest.done) break;
			LoreCardRenderer.loreBodyCache.delete(oldest.value);
		}
	}

	/**
	 * 解析词条正文（切片 + 别名提取 + 标记清理），供卡片正文与悬停预览共用。
	 * 解析结果按 文件修改时间 缓存，同一词条重复渲染不再重新读取与解析。
	 */
	static async resolveLoreBody(entry: LoreEntry, app: App): Promise<ResolvedLoreBody> {
		const cached = LoreCardRenderer.readCache(entry);
		if (cached) return cached;

		const targetFile = entry.file;
		const expectedMtime = LoreCardRenderer.getEntryMtime(targetFile);

		const resolved = await LoreCardRenderer.parseLoreBody(entry, app);
		LoreCardRenderer.writeCache(entry, resolved, expectedMtime, targetFile);
		return resolved;
	}

	private static async parseLoreBody(entry: LoreEntry, app: App): Promise<ResolvedLoreBody> {
		const fileContent = await app.vault.cachedRead(entry.file);
		const fileCache = app.metadataCache.getFileCache(entry.file);

		let chunk = '';
		const aliases: string[] = [];

		let hasMatchedH2 = false;
		if (fileCache && fileCache.headings) {
			const headings = fileCache.headings;
			let startIndex = -1;
			let endIndex = -1;

			for (let i = 0; i < headings.length; i++) {
				const h = headings[i];
				const rawHeading = cleanLoreHeading(h.heading);
				if (rawHeading === cleanLoreHeading(entry.heading) && h.level === 2) {
					hasMatchedH2 = true;
					startIndex = h.position.end.line + 1;
					let nextLevelH = null;
					for (let j = i + 1; j < headings.length; j++) {
						if (headings[j].level <= 2) {
							nextLevelH = headings[j];
							break;
						}
					}
					endIndex = nextLevelH ? nextLevelH.position.start.line : -1;
					break;
				}
			}

			if (startIndex !== -1) {
				const lines = fileContent.split('\n');
				const slice = endIndex === -1 ? lines.slice(startIndex) : lines.slice(startIndex, endIndex);
				const rawChunk = slice.join('\n');

				const aliasMatch = rawChunk.match(/^(?:\*\*|__)?(?:别名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/im);
				if (aliasMatch && aliasMatch[1]) {
					aliases.push(...aliasMatch[1].split(/[,，、/|;；]/).map(s => s.trim()).filter(Boolean));
					chunk = rawChunk.replace(aliasMatch[0], '').replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
				} else {
					chunk = rawChunk.replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
				}
			}
		}

		// 单文件词条模式回退（若无匹配的二级标题且词条名为文件名 basename）
		if (!hasMatchedH2 && cleanLoreHeading(entry.heading) === cleanLoreHeading(entry.file.basename)) {
			// 1. 从 Frontmatter 中解析别名
			const fm = fileCache?.frontmatter;
			if (fm) {
				const rawFmAliases = (fm['aliases'] ?? fm['alias'] ?? fm['别名']) as unknown;
				if (Array.isArray(rawFmAliases)) {
					for (const a of rawFmAliases) {
						if (typeof a === 'string' || typeof a === 'number') {
							const cleanA = String(a).trim();
							if (cleanA && !aliases.includes(cleanA)) aliases.push(cleanA);
						}
					}
				} else if (typeof rawFmAliases === 'string' && rawFmAliases.trim()) {
					for (const a of rawFmAliases.split(/[,，、/|;；]/)) {
						const cleanA = a.trim();
						if (cleanA && !aliases.includes(cleanA)) aliases.push(cleanA);
					}
				}
			}

			// 2. 移除 Frontmatter
			let bodyText = fileContent;
			if (bodyText.startsWith('---\n') || bodyText.startsWith('---\r\n')) {
				const endMatch = bodyText.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
				if (endMatch) {
					bodyText = bodyText.slice(endMatch[0].length);
				}
			}
			// 移除顶部的 # 一级标题（如果存在）
			bodyText = bodyText.replace(/^\s*#\s+[^\n]*\r?\n/, '');

			// 3. 从正文中解析别名声明行并提取
			const aliasMatches = bodyText.matchAll(/(?:\*\*|__)?(?:别名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/gi);
			for (const match of aliasMatches) {
				if (match[1]) {
					const rawAliases = match[1].split(/[,，、/|;；]/);
					for (const a of rawAliases) {
						const cleanA = a.trim();
						if (cleanA && !aliases.includes(cleanA)) {
							aliases.push(cleanA);
						}
					}
				}
			}
			// 从渲染内容中移除别名声明行，避免与顶部 badges 重复
			chunk = bodyText.replace(/^(?:\*\*|__)?(?:别名|Alias)(?:\*\*|__)?\s*[:：]\s*[^\n]+\r?\n?/gim, '').replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
		}

		return { chunk, aliases };
	}

	private static renderAliasBadges(header: HTMLElement, aliases: string[], component: Component): void {
		LoreCardRenderer.aliasBadgeCleanups.get(header)?.();
		header.querySelector('.wn-lore-card-badges')?.remove();

		if (aliases.length === 0) return;

		const starBtn = header.querySelector('.wn-card-importance-btn');
		const badgesContainer = starBtn
			? header.insertBefore(createDiv({ cls: 'wn-lore-card-badges is-measuring' }), starBtn)
			: header.createDiv({ cls: 'wn-lore-card-badges is-measuring' });
		const aliasBadges = aliases.map(alias =>
			badgesContainer.createSpan({ cls: 'wn-lore-card-badge', text: alias })
		);
		const overflowBadge = badgesContainer.createSpan({ cls: 'wn-lore-card-overflow-badge' });
		const ownerWindow = header.ownerDocument?.defaultView ?? null;
		let animationFrameId: number | null = null;
		let resizeObserver: ResizeObserver | null = null;
		let isCleanedUp = false;

		const layoutBadges = () => {
			animationFrameId = null;
			if (!badgesContainer.isConnected) return;

			badgesContainer.hidden = false;
			badgesContainer.addClass('is-measuring');
			for (const badge of aliasBadges) {
				badge.hidden = false;
				badge.removeClass('is-truncated');
			}
			overflowBadge.hidden = false;

			const style = ownerWindow?.getComputedStyle(badgesContainer);
			const paddingLeft = Math.ceil(Number.parseFloat(style?.paddingLeft ?? '0'));
			const paddingRight = Math.ceil(Number.parseFloat(style?.paddingRight ?? '0'));
			const gap = Math.ceil(Number.parseFloat(style?.columnGap || style?.gap || '0'));
			const availableWidth = Math.max(0, Math.floor(badgesContainer.clientWidth) - paddingLeft - paddingRight);
			const badgeWidths = aliasBadges.map(badge => Math.ceil(badge.getBoundingClientRect().width));
			const prefixWidths = [0];
			for (const width of badgeWidths) {
				prefixWidths.push(prefixWidths[prefixWidths.length - 1] + width);
			}

			const allAliasesWidth = prefixWidths[aliases.length] + gap * Math.max(0, aliases.length - 1);
			let visibleCount = -1;
			if (allAliasesWidth <= availableWidth) {
				visibleCount = aliases.length;
				overflowBadge.hidden = true;
			} else if (aliases.length === 1 && availableWidth > 0) {
				visibleCount = 1;
				aliasBadges[0].addClass('is-truncated');
				overflowBadge.hidden = true;
			} else {
				for (let count = aliases.length - 1; count >= 0; count--) {
					const hiddenCount = aliases.length - count;
					overflowBadge.setText(`+${hiddenCount}`);
					const overflowWidth = Math.ceil(overflowBadge.getBoundingClientRect().width);
					const aliasesWidth = prefixWidths[count] + gap * Math.max(0, count - 1);
					const totalWidth = aliasesWidth + (count > 0 ? gap : 0) + overflowWidth;
					if (totalWidth <= availableWidth) {
						visibleCount = count;
						overflowBadge.title = aliases.slice(count).join('、');
						break;
					}
				}
			}

			for (let index = 0; index < aliasBadges.length; index++) {
				aliasBadges[index].hidden = index >= Math.max(0, visibleCount);
			}
			if (visibleCount < 0) {
				overflowBadge.hidden = true;
				badgesContainer.hidden = true;
			}
			badgesContainer.removeClass('is-measuring');
		};

		const scheduleLayout = () => {
			if (isCleanedUp || animationFrameId !== null) return;
			if (ownerWindow) {
				animationFrameId = ownerWindow.requestAnimationFrame(layoutBadges);
			} else {
				layoutBadges();
			}
		};

		if (ownerWindow?.ResizeObserver) {
			resizeObserver = new ownerWindow.ResizeObserver(scheduleLayout);
			resizeObserver.observe(header);
		}
		scheduleLayout();

		const cleanup = () => {
			if (isCleanedUp) return;
			isCleanedUp = true;
			if (animationFrameId !== null && ownerWindow) {
				ownerWindow.cancelAnimationFrame(animationFrameId);
				animationFrameId = null;
			}
			resizeObserver?.disconnect();
			resizeObserver = null;
			if (LoreCardRenderer.aliasBadgeCleanups.get(header) === cleanup) {
				LoreCardRenderer.aliasBadgeCleanups.delete(header);
			}
		};
		LoreCardRenderer.aliasBadgeCleanups.set(header, cleanup);
		component.register(cleanup);
	}

	static async buildCardDOM(
		container: HTMLElement,
		entry: LoreEntry,
		plugin: LoreCardRendererPlugin,
		component: Component,
		options: {
			draggable?: boolean;
			dragDataMimeType?: string;
			onTitleClick?: () => void;
			hideEditButton?: boolean;
			hideImportanceButton?: boolean;
			/** 只读预览模式：隐藏编辑入口并禁用标题跳转，用于悬停大预览面板 */
			readOnly?: boolean;
			/** 卡片头部“展开大预览”按钮回调；未提供时不渲染该按钮 */
			onExpand?: () => void;
			/** 使卡片容器可聚焦，让键盘用户也能触发悬停预览 */
			focusable?: boolean;
		} = {}
	): Promise<void> {
		const isReadOnly = Boolean(options.readOnly);
		const card = container.createDiv({ cls: `wn-lore-card${entry.important ? ' is-important' : ''}${isReadOnly ? ' is-preview' : ''}` });
		if (options.focusable) {
			container.setAttr('tabindex', '0');
		}
		if (options.draggable) {
			card.setAttribute('draggable', 'true');
			card.setAttribute('data-lore-heading', entry.heading);
			card.addEventListener('dragstart', (e) => {
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'all';
					const mime = options.dragDataMimeType || 'application/wn-lore-heading';
					e.dataTransfer.setData(mime, entry.heading);
				}
				window.setTimeout(() => card.addClass('is-dragging'), 0);
			});
			card.addEventListener('dragend', () => {
				card.removeClass('is-dragging');
			});
		}

		// Header area
		const header = card.createDiv({ cls: 'wn-lore-card-header' });
		const titleContainer = header.createDiv({ cls: 'wn-lore-card-title-container' });

		const titleEl = titleContainer.createDiv({ cls: 'wn-lore-card-title' });
		titleEl.setText(entry.heading);
		titleEl.title = isReadOnly ? entry.heading : t('corkboard.click-to-open-lore');

		titleEl.onclick = async () => {
			if (isReadOnly) return;
			if (options.onTitleClick) {
				options.onTitleClick();
			}

			// 找到词条对应的行号，并分屏打开
			const fileCache = plugin.app.metadataCache.getFileCache(entry.file);
			let fallbackLine: number | undefined;
			if (fileCache && fileCache.headings) {
				for (const h of fileCache.headings) {
					const rawHeading = cleanLoreHeading(h.heading);
					if (rawHeading === cleanLoreHeading(entry.heading)) {
						fallbackLine = h.position.start.line;
						break;
					}
				}
			}
			
			await smartLocateAndHighlight(plugin.app, entry.file, [`## ${entry.heading}`, `# ${entry.heading}`, entry.heading], {
				splitIfNew: true,
				fallbackLine
			});
		};

		if (!options.hideEditButton && !isReadOnly) {
			const editBtn = titleContainer.createDiv({ cls: LORE_CARD_EDIT_BTN_CLASS });
			setIcon(editBtn, 'pencil');
			editBtn.title = t('corkboard.edit-lore');
		
			let isEditing = false;
			editBtn.onclick = async () => {
				if (isEditing) return;
				isEditing = true;
				if (options.draggable) card.setAttribute('draggable', 'false');

				const maxBodyScroll = Math.max(1, body.scrollHeight - body.clientHeight);
				const scrollRatio = Math.max(0, Math.min(1, body.scrollTop / maxBodyScroll));

				const oldContentEls = Array.from(body.children);
				oldContentEls.forEach((el) => { (el as HTMLElement).hidden = true; });

				body.addClass('is-editing');
				const editorContainer = body.createDiv({ cls: 'wn-lore-card-editor' });
				const rawContent = await plugin.characterManager.getLoreContent(entry);
				const editor = createStickyNoteParagraphEditor(editorContainer, rawContent, 'wn-lore-card-textarea');

				const ownerWindow = editor.ownerDocument?.defaultView ?? null;
				const scheduleLayout = (cb: () => void) => {
					if (ownerWindow?.requestAnimationFrame) {
						ownerWindow.requestAnimationFrame(cb);
					} else if (ownerWindow?.setTimeout) {
						ownerWindow.setTimeout(cb, 0);
					} else {
						cb();
					}
				};

				scheduleLayout(() => {
					if (!editor.isConnected) return;
					const roughCharIndex = Math.floor(rawContent.length * scrollRatio);
					editor.focus({ preventScroll: true });
					setCaretPosition(editor, roughCharIndex);
					const maxEditorScroll = Math.max(0, editor.scrollHeight - editor.clientHeight);
					editor.scrollTop = Math.round(scrollRatio * maxEditorScroll);
				});

				let isSaving = false;
				let isCancelled = false;

				const exitEdit = () => {
					body.removeClass('is-editing');
					editorContainer.remove();
					oldContentEls.forEach((el) => { (el as HTMLElement).hidden = false; });
					isEditing = false;
					if (options.draggable) card.setAttribute('draggable', 'true');
				};

				const performSave = async () => {
					if (isSaving || isCancelled) return;
					const newVal = editor.value;
					if (newVal !== rawContent) {
						isSaving = true;
						await plugin.characterManager.updateLoreContent(entry, newVal);
						body.removeClass('is-editing');
						body.empty();
						isEditing = false;
						if (options.draggable) card.setAttribute('draggable', 'true');
						LoreCardRenderer.clearLoreBodyCache(entry.file);
						await LoreCardRenderer.renderBodyContent(body, header, entry, plugin, component);
					} else {
						exitEdit();
					}
				};

				editor.addEventListener('blur', () => {
					void performSave();
				});

				editor.addEventListener('keydown', (e) => {
					if (e.key === 'Escape') {
						e.preventDefault();
						isCancelled = true;
						exitEdit();
					}
				});
			};
		}

		if (!options.hideImportanceButton && plugin.characterManager.toggleLoreImportance) {
			createCardImportanceButton({
				container: header,
				isImportant: !!entry.important,
				cardEl: card,
				onToggle: async (nextState) => {
					await plugin.characterManager.toggleLoreImportance!(entry);
					entry.important = nextState;
				}
			});
		}

		// 展开大预览按钮：桌面端与移动端共用的显式入口（移动端无 hover 时唯一入口）
		if (options.onExpand && !isReadOnly) {
			const expandBtn = titleContainer.createDiv({ cls: LORE_CARD_EXPAND_BTN_CLASS });
			setIcon(expandBtn, 'maximize-2');
			expandBtn.title = t('corkboard.lore-expand-preview');
			expandBtn.setAttr('aria-label', t('corkboard.lore-expand-preview'));
			expandBtn.setAttr('role', 'button');
			expandBtn.setAttr('tabindex', '0');
			expandBtn.onclick = (event) => {
				event?.stopPropagation();
				options.onExpand?.();
			};
			expandBtn.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				event.stopPropagation();
				options.onExpand?.();
			});
		}

		// Body area
		const body = card.createDiv({ cls: 'wn-lore-card-body' });
		body.setAttr('tabindex', '0');
		await LoreCardRenderer.renderBodyContent(body, header, entry, plugin, component, { collapseSubheadings: !isReadOnly });
	}

	private static async renderBodyContent(
		body: HTMLElement,
		header: HTMLElement,
		entry: LoreEntry,
		plugin: LoreCardRendererPlugin,
		component: Component,
		options: { collapseSubheadings?: boolean } = {}
	): Promise<void> {
		const loadingEl = body.createDiv({ cls: 'wn-lore-card-loading', text: t('common.loading') });
		try {
			const { chunk: chunkToRender, aliases } = await LoreCardRenderer.resolveLoreBody(entry, plugin.app);

			loadingEl.remove();

			LoreCardRenderer.renderAliasBadges(header, aliases, component);

			if (chunkToRender) {
				const markdownContainer = body.createDiv({ cls: 'wn-lore-markdown' });
				await MarkdownRenderer.render(plugin.app, chunkToRender, markdownContainer, entry.file.path, component);
				injectSoftBreakIndentPlaceholders(markdownContainer, false);

				if (plugin.settings.lorePopoverCollapse && options.collapseSubheadings !== false) {
					const headingEls = Array.from(markdownContainer.querySelectorAll<HTMLElement>('h3, h4, h5, h6'));
					if (headingEls.length > 0) {
						const updateVisibility = () => {
							const children = Array.from(markdownContainer.children) as HTMLElement[];
							let activeCollapsedLevel = 99;

							for (const child of children) {
								if (child.tagName.match(/^H[3-6]$/i)) {
									const level = parseInt(child.tagName.substring(1), 10);
									if (level <= activeCollapsedLevel) {
										activeCollapsedLevel = 99;
									}

									if (activeCollapsedLevel < level) {
										child.addClass('is-hidden');
									} else {
										child.removeClass('is-hidden');
										if (child.hasClass('is-collapsed')) {
											activeCollapsedLevel = level;
										}
									}
								} else {
									if (activeCollapsedLevel < 99) {
										child.addClass('is-hidden');
									} else {
										child.removeClass('is-hidden');
									}
								}
							}
						};

						for (const el of headingEls) {
							el.addClass('is-collapsible');
							el.addClass('is-collapsed');

							el.addEventListener('click', (e) => {
								e.stopPropagation();
								if (el.hasClass('is-collapsed')) {
									el.removeClass('is-collapsed');
								} else {
									el.addClass('is-collapsed');
								}
								updateVisibility();
							});
						}

						updateVisibility();
					}
				}
			} else {
				body.createDiv({ cls: 'wn-lore-card-empty', text: t('corkboard.lore-empty-content') });
			}
		} catch (e) {
			loadingEl.setText(t('common.error-loading'));
			console.error(e);
		}
	}
}
