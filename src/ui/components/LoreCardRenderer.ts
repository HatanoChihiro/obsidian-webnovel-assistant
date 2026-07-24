import { MarkdownRenderer, type Component, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import type { LoreEntry } from '../../services/CharacterManager';
import { openFileAndFocus } from '../../utils/leaf';


export class LoreCardRenderer {
	static async buildCardDOM(
		container: HTMLElement,
		entry: LoreEntry,
		plugin: WebNovelAssistantPlugin,
		component: Component,
		options: {
			draggable?: boolean;
			dragDataMimeType?: string;
			onTitleClick?: () => void;
			hideEditButton?: boolean;
		} = {}
	): Promise<void> {
		const card = container.createDiv({ cls: 'wn-lore-card' });
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
		titleEl.title = t('corkboard.click-to-open-lore');

		titleEl.onclick = async () => {
			if (options.onTitleClick) {
				options.onTitleClick();
			}
			
			// 找到词条对应的行号，并分屏打开
			const fileCache = plugin.app.metadataCache.getFileCache(entry.file);
			let line = 0;
			if (fileCache && fileCache.headings) {
				for (const h of fileCache.headings) {
					const rawHeading = h.heading.replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '');
					if (rawHeading === entry.heading && h.level === 2) {
						line = h.position.start.line;
						break;
					}
				}
			}
			
			let targetLeaf = plugin.app.workspace.getLeavesOfType('markdown').find(l => (l.view as unknown as { file?: { path: string } }).file?.path === entry.file.path);
			if (!targetLeaf) targetLeaf = plugin.app.workspace.getLeaf('split', 'vertical');
			await openFileAndFocus(plugin.app, targetLeaf, entry.file, { eState: { line } });
		};

		if (!options.hideEditButton) {
			const editBtn = titleContainer.createDiv({ cls: 'wn-lore-card-edit-btn' });
			setIcon(editBtn, 'pencil');
			editBtn.title = t('corkboard.edit-lore');
		
			let isEditing = false;
			editBtn.onclick = async () => {
			if (isEditing) return;
			isEditing = true;
			if (options.draggable) card.setAttribute('draggable', 'false');

			const currentScrollTop = body.scrollTop;
			const scrollHeightBefore = body.scrollHeight || 1;
			const scrollRatio = currentScrollTop / scrollHeightBefore;

			const oldContentEls = Array.from(body.children);
			oldContentEls.forEach((el) => (el as HTMLElement).setCssStyles({ display: 'none' }));

			const editorContainer = body.createDiv({ cls: 'wn-lore-card-editor' });
			const textarea = editorContainer.createEl('textarea', { cls: 'wn-lore-card-textarea' });
			
			const rawContent = await plugin.characterManager.getLoreContent(entry);
			textarea.value = rawContent;
			window.setTimeout(() => {
				textarea.setCssStyles({ height: textarea.scrollHeight + 'px' });
				
				const roughCharIndex = Math.floor(rawContent.length * scrollRatio);
				textarea.focus({ preventScroll: true });
				textarea.setSelectionRange(roughCharIndex, roughCharIndex);
				
				body.scrollTop = currentScrollTop;
			}, 0);
			textarea.oninput = () => {
				const currentScroll = body.scrollTop;
				const currentScrollHeight = body.scrollHeight;

				// 暂时固定容器高度，防止 textarea 缩小时容器也跟着缩小导致 scrollTop 被浏览器强制归零
				body.setCssStyles({ minHeight: currentScrollHeight + 'px' });

				textarea.setCssStyles({ height: 'auto' });
				textarea.setCssStyles({ height: textarea.scrollHeight + 'px' });

				body.setCssStyles({ minHeight: '' });
				body.scrollTop = currentScroll;
			};

			let isSaving = false;
			let isCancelled = false;

			const exitEdit = () => {
				editorContainer.remove();
				oldContentEls.forEach((el) => (el as HTMLElement).setCssStyles({ display: '' }));
				isEditing = false;
				if (options.draggable) card.setAttribute('draggable', 'true');
			};

			const performSave = async () => {
				if (isSaving || isCancelled) return;
				const newVal = textarea.value;
				if (newVal !== rawContent) {
					isSaving = true;
					await plugin.characterManager.updateLoreContent(entry, newVal);
					body.empty();
					isEditing = false;
					if (options.draggable) card.setAttribute('draggable', 'true');
					await LoreCardRenderer.renderBodyContent(body, header, entry, plugin, component);
				} else {
					exitEdit();
				}
			};

			textarea.addEventListener('blur', () => {
				void performSave();
			});

			textarea.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					isCancelled = true;
					exitEdit();
				}
			});
		};
		}

		// Body area
		const body = card.createDiv({ cls: 'wn-lore-card-body' });
		body.setAttr('tabindex', '0');
		await LoreCardRenderer.renderBodyContent(body, header, entry, plugin, component);
	}

	private static async renderBodyContent(
		body: HTMLElement,
		header: HTMLElement,
		entry: LoreEntry,
		plugin: WebNovelAssistantPlugin,
		component: Component
	): Promise<void> {
		const loadingEl = body.createDiv({ cls: 'wn-lore-card-loading', text: t('common.loading') });
		try {
			const fileContent = await plugin.app.vault.cachedRead(entry.file);
			const fileCache = plugin.app.metadataCache.getFileCache(entry.file);

			let chunkToRender = '';
			let aliases: string[] = [];

			if (fileCache && fileCache.headings) {
				const headings = fileCache.headings;
				let startIndex = -1;
				let endIndex = -1;

				for (let i = 0; i < headings.length; i++) {
					const h = headings[i];
					const rawHeading = h.heading.replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '');
					if (rawHeading === entry.heading && h.level === 2) {
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
						aliases = aliasMatch[1].split(/[,，、/|]/).map(s => s.trim()).filter(Boolean);
						chunkToRender = rawChunk.replace(aliasMatch[0], '').trim();
					} else {
						chunkToRender = rawChunk.trim();
					}
				}
			}

			loadingEl.remove();

			if (aliases.length > 0) {
				const existingBadges = header.querySelector('.wn-lore-card-badges');
				if (existingBadges) existingBadges.remove();
				
				const badgesContainer = header.createDiv({ cls: 'wn-lore-card-badges' });
				for (const alias of aliases) {
					badgesContainer.createSpan({ cls: 'wn-lore-card-badge', text: alias });
				}
			}

			if (chunkToRender) {
				const markdownContainer = body.createDiv({ cls: 'wn-lore-markdown' });
				await MarkdownRenderer.render(plugin.app, chunkToRender, markdownContainer, entry.file.path, component);

				if (plugin.settings.lorePopoverCollapse) {
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
