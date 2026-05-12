import { Extension, StateField, RangeSetBuilder } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { App, MarkdownView, TFile, editorInfoField } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';

class WordCountMarker extends GutterMarker {
	count: number;

	constructor(count: number) {
		super();
		this.count = count;
	}

	toDOM() {
		// 返回一个 0 宽高、内容允许溢出的包装器，从而不影响任何文档流
		const wrapper = document.createElement('div');
		wrapper.className = 'webnovel-word-count-marker-wrapper';

		// 核心黑科技：插入零宽字符，强制让这个包装器继承 Obsidian 当前的真实字体行高！
		wrapper.appendChild(document.createTextNode('\u200B'));

		const span = document.createElement('span');
		span.className = 'webnovel-word-count-marker';
		span.textContent = `${this.count}字`;

		wrapper.appendChild(span);
		return wrapper;
	}

	eq(other: WordCountMarker) {
		return this.count === other.count;
	}
}

/**
 * 可靠地从 CodeMirror View 中获取对应的 Obsidian TFile
 */
function getFileFromView(view: EditorView): TFile | null {
	try {
		// 官方推荐方式：从 state field 中获取 editorInfo
		return view.state.field(editorInfoField).file || null;
	} catch (e) {
		// 降级方案：如果 field 不存在
		if ((view as any).file) return (view as any).file;
		return null;
	}
}

/**
 * 创建字数实时提醒的 Gutter 扩展
 */
export function createWordCountGutter(plugin: WebNovelAssistantPlugin): Extension {
	// 维护每一行的字数和累计字数
	// 因为文档可能会非常大，直接把行字数存入 StateField 比较麻烦
	// 我们采用一个简单高效的策略：
	// 1. 在 state 中存储一个对象，记录文档总字数以及每个 mark 的行号
	// 2. 只有当用户停留或打字时，通过简单的节流来重算 markers

	// 为了确保真正的绝对性能和与 Obsidian 各种模式兼容，
	// 最安全的方式是利用 StateField<RangeSet<GutterMarker>> 配合 RangeSetBuilder
	// 但这要求每次变化都能精准映射。

	// 简化方案：我们可以在 view 层面进行挂载，通过 plugin 提供的计算方法获取。

	const wordCountStateField = StateField.define<{ lineCounts: number[] }>({
		create(state) {
			const lineCounts: number[] = [];
			const doc = state.doc;
			const lines = doc.lines;

			for (let i = 1; i <= lines; i++) {
				const lineText = doc.line(i).text;
				lineCounts.push(plugin.calculateAccurateWords(lineText));
			}

			return { lineCounts };
		},
		update(value, tr) {
			if (!tr.docChanged) {
				return value;
			}

			// [优化] 增量计算：只重新计算发生变化的行
			// 利用 tr.changes.iterChanges 获取变动范围
			let lineCounts = [...value.lineCounts];
			
			tr.changes.iterChanges((fromA, toA, fromB, toB, text) => {
				// fromA/toA 是旧文档中的位置，fromB/toB 是新文档中的位置
				// text 是插入的新文本内容
				
				const startLine = tr.startState.doc.lineAt(fromA).number;
				const endLine = tr.startState.doc.lineAt(toA).number;
				const deletedLinesCount = endLine - startLine + 1;
				
				const addedLinesCount = text.lines;
				const addedCounts: number[] = [];
				
				// 计算新插入行的字数
				for (let i = 1; i <= addedLinesCount; i++) {
					const lineText = text.line(i).toString();
					addedCounts.push(plugin.calculateAccurateWords(lineText));
				}
				
				// 替换旧行的字数记录
				lineCounts.splice(startLine - 1, deletedLinesCount, ...addedCounts);
			});

			return { lineCounts };
		}
	});

	const wordCountGutter = gutter({
		class: 'webnovel-word-count-gutter',
		markers: (view) => {
			const builder = new RangeSetBuilder<GutterMarker>();
			if (!plugin.settings.enableWordCountGutter) return builder.finish();

			// 获取当前视图对应的文件（实时获取，不缓存，避免复用视图导致判断错误）
			const file = getFileFromView(view);

			// 是否展示分章标签：
			// - 如果开启了严格章节模式，则必须是章节文件才显示
			// - 如果没有开启严格模式，则所有工作区内的文件都显示
			if (!file || !plugin.isFileInWorkspace(file)) {
				return builder.finish();
			}
			if (plugin.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
				return builder.finish();
			}

			const interval = plugin.settings.wordCountInterval || 2000;
			const state = view.state.field(wordCountStateField);

			let currentTotal = 0;
			let nextTarget = interval;

			// 遍历每一行计算累计字数
			const doc = view.state.doc;
			const lines = doc.lines;

			for (let i = 1; i <= lines; i++) {
				const lineCount = state.lineCounts[i - 1] || 0;
				currentTotal += lineCount;

				// 如果达到了下一个目标节点
				if (currentTotal >= nextTarget && lineCount > 0) {
					// 计算当前行越过了多少个 interval
					const reachedTarget = Math.floor(currentTotal / interval) * interval;
					const linePos = doc.line(i).from;
					builder.add(linePos, linePos, new WordCountMarker(reachedTarget));
					nextTarget = reachedTarget + interval;
				}
			}

			return builder.finish();
		}
	});

	const wordCountWorkspacePlugin = ViewPlugin.fromClass(class {
		constructor(view: EditorView) {
			this.updateClass(view);
		}
		update(update: ViewUpdate) {
			// 文件可能在生命周期中改变，或者工作区设置改变
			this.updateClass(update.view);
		}
		updateClass(view: EditorView) {
			if (!plugin.settings.enableWordCountGutter) {
				view.dom.classList.remove('webnovel-show-gutter');
				return;
			}

			const file = getFileFromView(view);
			const inWorkspace = file && plugin.isFileInWorkspace(file);

			// 如果开启了严格章节模式，还需要是章节文件
			const strictOk = !plugin.settings.enableStrictChapterMode ||
				(file && ChapterSorter.isChapterFile(file.name));

			if (inWorkspace && strictOk) {
				view.dom.classList.add('webnovel-show-gutter');
			} else {
				view.dom.classList.remove('webnovel-show-gutter');
			}
		}
	});

	return [
		wordCountStateField,
		wordCountGutter,
		wordCountWorkspacePlugin
	];
}
