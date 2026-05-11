import { Extension, StateField, RangeSetBuilder } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, ViewPlugin, ViewUpdate } from '@codemirror/view';
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
 * （由于 Obsidian 可能复用 EditorView，因此每次实时提取）
 */
function getFileFromView(view: EditorView, plugin: WebNovelAssistantPlugin): any {
	// 方法1：如果 view 上已经挂载了 file
	if ((view as any).file) return (view as any).file;

	// 方法2：从 CodeMirror 的 state values 中寻找 Obsidian 的 editorInfoField
	const values = (view.state as any).values;
	if (Array.isArray(values)) {
		const editorInfo = values.find((v: any) => v && v.file && typeof v.file.path === 'string');
		if (editorInfo) return editorInfo.file;
	}

	// 方法3：最强力的 DOM 匹配。遍历所有叶子节点，看哪个叶子节点的 DOM 包含了当前编辑器的 DOM
	let file = null;
	plugin.app.workspace.iterateAllLeaves(l => {
		const leafView = l.view as any;
		if (!leafView) return;

		const cm = leafView.editor?.cm || leafView.editor?.cm?.cm;
		// 优先通过引用比对，如果引用失效，则通过 DOM 层级比对
		if (cm === view || (leafView.containerEl && leafView.containerEl.contains(view.dom))) {
			file = leafView.file;
		}
	});
	return file;
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

	const wordCountStateField = StateField.define<{ lineCounts: number[], markers: any }>({
		create(state) {
			const lineCounts: number[] = [];
			const doc = state.doc;
			const lines = doc.lines;

			for (let i = 1; i <= lines; i++) {
				const lineText = doc.line(i).text;
				lineCounts.push(plugin.calculateAccurateWords(lineText));
			}

			return { lineCounts, markers: null };
		},
		update(value, tr) {
			if (!tr.docChanged) {
				return value;
			}

			// 简单的全量计算，因为对于单章（即使是 1 万字），
			// 也就是几百行代码，正则计算耗时在 1-2ms 内，完全不会卡顿。
			// 但是为了进一步优化，我们只在真正需要的时候（比如行数变化或者文本大幅变化）才重新算。
			const lineCounts: number[] = [];
			const doc = tr.state.doc;
			const lines = doc.lines;

			// 注意：这里为了不阻塞主线程，如果行数过大（>5000行），可以考虑优化
			// 但网文单章极少超过 5000 行。
			for (let i = 1; i <= lines; i++) {
				const lineText = doc.line(i).text;
				// 复用核心的字数计算逻辑
				const count = plugin.calculateAccurateWords(lineText);
				lineCounts.push(count);
			}

			return { lineCounts, markers: null };
		}
	});

	const wordCountGutter = gutter({
		class: 'webnovel-word-count-gutter',
		markers: (view) => {
			const builder = new RangeSetBuilder<GutterMarker>();
			if (!plugin.settings.enableWordCountGutter) return builder.finish();

			// 获取当前视图对应的文件（实时获取，不缓存，避免复用视图导致判断错误）
			const file = getFileFromView(view, plugin);

			// 是否展示分章标签：
			// - 如果开启了严格章节模式，则必须是章节文件才显示
			// - 如果没有开启严格模式，则所有工作区内的文件都显示
			if (!file || !plugin.isFileInWorkspace(file)) {
				return builder.finish();
			}
			if (plugin.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
				return builder.finish();
			}

			const interval = parseInt(plugin.settings.wordCountInterval as any) || 2000;
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

			const file = getFileFromView(view, plugin);
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
