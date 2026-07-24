import type { App, WorkspaceLeaf, TFile } from 'obsidian';
import { MarkdownView } from 'obsidian';
import type { Extension } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { ViewPlugin, Decoration } from '@codemirror/view';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { isMobile } from '../utils/platform';
import { LoreHoverPopover } from '../ui/LoreHoverPopover';

import { editorInfoField } from 'obsidian';

const touchStateMap = new WeakMap<EditorView, {startX: number, startY: number}>();


/**
 * 构造角色名悬停的 CodeMirror 扩展
 */
export function buildCharacterHoverExtension(app: App, plugin: WebNovelAssistantPlugin): Extension {
	
	// 构建 ViewPlugin
	const hoverPlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		private cachedPattern: RegExp | null = null;
		private cachedCharsLength: number = -1;
		private lastCacheVersion: number = -1;

		constructor(view: EditorView) {
			this.lastCacheVersion = plugin.characterManager?.cacheVersion || 0;
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			const currentVersion = plugin.characterManager?.cacheVersion || 0;
			if (update.docChanged || update.viewportChanged || this.lastCacheVersion !== currentVersion) {
				this.lastCacheVersion = currentVersion;
				this.decorations = this.buildDecorations(update.view);
			}
		}

		private getFile(view: EditorView): TFile | null {
			try {
				const file = view.state.field(editorInfoField).file;
				if (file) return file;
			} catch {
				// Fallback 策略：在特殊视图模式下尝试从 workspace 检索
			}

			let foundFile: TFile | null = null;
			app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
				const v = leaf.view;
				if (v instanceof MarkdownView && v.editor) {
					const cmEditor = v.editor as unknown as { cm: EditorView };
					if (cmEditor.cm === view) {
						foundFile = v.file;
					}
				}
			});
			return foundFile;
		}

		buildDecorations(view: EditorView): DecorationSet {
			const builder = [];
			
			const activeFile = this.getFile(view);

			if (!activeFile) {
				return Decoration.none;
			}

			if (!plugin.characterManager) return Decoration.none;
			
			const bookPath = plugin.characterManager.getBookPathForFile(activeFile);
			if (!bookPath) return Decoration.none;

			const characters = plugin.characterManager.getCharactersForBook(bookPath);
			if (characters.length === 0) return Decoration.none;

			// 缓存正则以避免每次键盘输入都重新编译大量正则
			if (this.cachedCharsLength !== characters.length || !this.cachedPattern) {
				const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				// 安全措施：过滤空字符串，防止编译出匹配空串的正则导致无限循环
				const validChars = characters.filter(c => c.length > 0);
				if (validChars.length === 0) return Decoration.none;
				this.cachedPattern = new RegExp(`(${validChars.map(escapeRegExp).join('|')})`, 'g');
				this.cachedCharsLength = characters.length;
			}
			const pattern = this.cachedPattern;

			// 只扫描当前视口内的文本
			for (const { from, to } of view.visibleRanges) {
				pattern.lastIndex = 0; // 必须重置，因为我们在循环里重用同一个带 /g 的正则
				const text = view.state.doc.sliceString(from, to);
				let match;
				while ((match = pattern.exec(text)) !== null) {
					// 安全网：防止零长度匹配导致死循环
					if (match[0].length === 0) { pattern.lastIndex++; continue; }
					const start = from + match.index;
					const end = start + match[0].length;
					
					// 为每个匹配项挂载专属 class 和数据属性，以便 hover 事件读取
					builder.push(Decoration.mark({
						class: 'wn-character-match',
						attributes: { 
							'data-character': match[0], 
							'data-bookpath': bookPath,
							'data-sourcepath': activeFile.path
						}
					}).range(start, end));
				}
			}

			// 需要排序后提供给 DecorationSet
			return Decoration.set(builder.sort((a, b) => a.from - b.from));
		}
	}, {
		decorations: v => v.decorations,
		eventHandlers: {
			mouseover(e: MouseEvent, _view: EditorView) {
				const target = (e.target as HTMLElement)?.closest('.wn-character-match') as HTMLElement;
				if (target) {
					const characterName = target.getAttribute('data-character');
					const bookPath = target.getAttribute('data-bookpath');
					
					if (characterName && bookPath && plugin.characterManager) {
						const charEntry = plugin.characterManager.getCharacterFile(bookPath, characterName);
						if (charEntry) {
							new LoreHoverPopover(target, charEntry, plugin);
						}
					}
				}
			},
			click(e: MouseEvent, _view: EditorView) {
				if (isMobile() && !plugin.settings.enableMobileLorePopover) return;
				const target = (e.target as HTMLElement)?.closest('.wn-character-match') as HTMLElement;
				if (target) {
					const characterName = target.getAttribute('data-character');
					const bookPath = target.getAttribute('data-bookpath');
					
					if (characterName && bookPath && plugin.characterManager) {
						const charEntry = plugin.characterManager.getCharacterFile(bookPath, characterName);
						if (charEntry) {
							new LoreHoverPopover(target, charEntry, plugin, true);
						}
					}
				}
			},
			touchstart(e: TouchEvent, view: EditorView) {
				if (isMobile() && !plugin.settings.enableMobileLorePopover) return;
				if (e.touches.length > 0) {
					touchStateMap.set(view, {
						startX: e.touches[0].clientX,
						startY: e.touches[0].clientY
					});
				}
			},
			touchend(e: TouchEvent, view: EditorView) {
				if (isMobile() && !plugin.settings.enableMobileLorePopover) return;
				const state = touchStateMap.get(view);
				if (!state) return;
				
				const { startX, startY } = state;
				touchStateMap.delete(view);
				
				if (e.changedTouches.length > 0) {
					const dx = e.changedTouches[0].clientX - startX;
					const dy = e.changedTouches[0].clientY - startY;
					// 如果移动距离小于 10 像素，认为是轻点 (Tap)
					if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
						const target = (e.target as HTMLElement)?.closest('.wn-character-match') as HTMLElement;
						if (target) {
							const characterName = target.getAttribute('data-character');
							const bookPath = target.getAttribute('data-bookpath');
							
							if (characterName && bookPath && plugin.characterManager) {
								const charEntry = plugin.characterManager.getCharacterFile(bookPath, characterName);
								if (charEntry) {
									new LoreHoverPopover(target, charEntry, plugin, true);
								}
							}
						}
					}
				}
			}
		}
	});

	return hoverPlugin;
}
