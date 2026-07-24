import { Logger } from '../utils/Logger';

import { isDesktop } from '../utils';
import { FloatingStickyNote } from '../ui/StickyNote';
import { Notice, type TFile } from 'obsidian';
import { t } from '../i18n';
import type { StickyNoteState } from '../types/settings';
import { SerializedWriter } from '../utils/SerializedWriter';
import { getPluginDir } from '../utils/platform';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 便签数据管理器
 * 负责将便签内容持久化到独立的 notes-data.json 文件中，避免 data.json 过大
 */
export class StickyNoteDataManager {
	private notesData: StickyNoteState[] = [];
	private plugin: WebNovelAssistantPlugin;
	private notesFilePath: string;
	private writer = new SerializedWriter();
	private _isWriting = false;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
		this.notesFilePath = `${getPluginDir(plugin)}/notes-data.json`;
	}

	/**
	 * 加载便签数据
	 */
	async loadNotes(): Promise<StickyNoteState[]> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			
			// 1. 尝试从独立文件读取
			if (await adapter.exists(this.notesFilePath)) {
				const content = await adapter.read(this.notesFilePath);
				// [BUGFIX] 对解析结果进行类型守卫：若文件内容损坏（如 {} 或非数组），
				// 直接使用会导致 forEach/map 等调用崩溃，安全降级为空数组。
				const parsed = JSON.parse(content) as StickyNoteState[];
				const rawNotes = Array.isArray(parsed) ? parsed : [];
				
				// [BUGFIX] 验证每个条目的结构，确保至少有 id
				this.notesData = rawNotes.filter(n => n && typeof n === 'object' && typeof n.id === 'string');
				
				if (this.notesData.length !== rawNotes.length) {
					Logger.warn(`[StickyNoteDataManager] 过滤掉 ${rawNotes.length - this.notesData.length} 个无效便签条目`);
				}
				
				return this.notesData;
			}


			return [];
		} catch (error) {
			Logger.error("[StickyNoteDataManager] 加载便签数据失败:", error);
			return [];
		}
	}

	/**
	 * 保存便签数据
	 */
	async saveNotes(notes: StickyNoteState[]): Promise<void> {
		// 使用串行写入器确保顺序写入，防止文件损坏
		return this.writer.enqueue(async () => {
			this._isWriting = true;
			try {
				const adapter = this.plugin.app.vault.adapter;
				const content = JSON.stringify(notes);
				await adapter.write(this.notesFilePath, content);
				this.notesData = notes;
				// 触发全局事件，通知其他组件同步数据
				this.plugin.app.workspace.trigger('webnovel:notes-changed');
			} catch (error) {
				Logger.error("[StickyNoteDataManager] 保存便签数据失败:", error);
			} finally {
				this._isWriting = false;
			}
		});
	}

	/**
	 * 获取当前内存中的便签数据
	 */
	getNotes(): StickyNoteState[] {
		return this.notesData;
	}

	/**
	 * 更新单个便签数据（自动触发持久化与悬浮便签同步）
	 * @param noteState 便签状态
	 * @param debounceSave 是否防抖保存文件
	 */
	updateNote(noteState: StickyNoteState, debounceSave = false): void {
		const index = this.notesData.findIndex(n => n.id === noteState.id);
		if (index !== -1) {
			this.notesData[index] = { ...noteState };
		} else {
			this.notesData.push({ ...noteState });
		}
		
		// 实时同步所有桌面端悬浮便签 UI 状态
		this.syncFloatingNotes();

		if (debounceSave) {
			const debounceKey = `save-note-data-manager`;
			this.plugin.adaptiveDebounceManager.debounceFixed(debounceKey, () => {
				void this.saveNotes(this.notesData);
			}, 500);
		} else {
			this.saveNotes(this.notesData).catch(err => {
				Logger.error('[StickyNoteDataManager] updateNote 自动保存失败:', err);
			});
		}
	}

	/**
	 * 强制等待所有待处理的保存操作完成
	 * 主要用于 onunload 生命周期
	 */
	async flush(): Promise<void> {
		await this.writer.flush();
	}

	/**
	 * 移除便签（自动触发持久化与悬浮便签同步）
	 */
	removeNote(id: string): void {
		this.notesData = this.notesData.filter(n => n.id !== id);
		this.syncFloatingNotes();
		this.saveNotes(this.notesData).catch(err => {
			Logger.error('[StickyNoteDataManager] removeNote 自动保存失败:', err);
		});
	}

	/**
	 * 检查是否有未保存的更改
	 */
	isDirty(): boolean {
		return this.writer.isDirty();
	}

	getIsWriting(): boolean {
		return this._isWriting;
	}
	/**
	 * 获取便签数据文件的 Vault 相对路径
	 */
	getNotesFilePath(): string {
		return this.notesFilePath;
	}


	public activeNotes: FloatingStickyNote[] = [];

	/**
	 * 将所有活跃悬浮便签的当前内容强制同步到管理器
	 * 通常在切换工作区（如进入沉浸模式）或插件卸载前调用
	 */
	public syncActiveNotesToManager(): void {
		if (!isDesktop()) return;
		this.activeNotes.forEach(note => {
			if (note.state.isEditing && note.textareaEl) {
				note.state.content = note.textareaEl.value;
			}
			this.updateNote(note.state);
		});
		// [BUGFIX] updateNote 只更新内存，需要在此显式触发持久化，
		// 防止进入沉浸模式或插件卸载时便签内容丢失。
		this.saveNotes(this.getNotes()).catch(err => {
			Logger.error('[Plugin] syncActiveNotesToManager 保存便签失败:', err);
		});
	}

	/**
	 * 同步沉浸模式产生的便签变更到桌面悬浮便签
	 */
	public syncFloatingNotes(): void {
		// 仅在桌面端同步浮动便签
		// (this.plugin as unknown as { _unloading?: boolean })._unloading 也可以不用强求，或者用 this.plugin 检查
		if (!isDesktop() || (this.plugin as unknown as { _unloading?: boolean })._unloading) return;

		const notes = this.getNotes();

		// 1. 关闭那些已经在沉浸模式中被移除的便签
		const openNoteIds = new Set(notes.map(n => n.id));
		[...this.activeNotes].forEach(note => {
			if (!openNoteIds.has(note.state.id)) {
				// 静默销毁
				note.destroy();
			}
		});

		// 2. 处理沉浸模式中新建或编辑过的便签
		const activeIds = new Set(this.activeNotes.map(n => n.state.id));
		for (const noteState of notes) {
			if (!activeIds.has(noteState.id)) {
				const newNote = new FloatingStickyNote(this.plugin.app, this.plugin, { state: noteState });
				newNote.load();
			} else {
				// 更新已存在的便签内容和状态
				const existingNote = this.activeNotes.find(n => n.state.id === noteState.id);
				if (existingNote) {
					existingNote.updateFromState(noteState);
				}
			}
		}
	}

	/**
	 * 创建便签（处理沉浸模式同步）
	 */
	public async createStickyNote(options: { file?: TFile, content?: string, title?: string }) {
		// 如果在移动端调用（如通过命令），由于交互限制，仅给予提示或在沉浸模式中处理
		if (!isDesktop()) {
			// 在沉浸模式中创建是允许的，因为它会渲染到辅助面板视图中
			if (!activeDocument.body.classList.contains('immersive-mode-active')) {
				new Notice(t('notice.floating-notes-desktop-only'));
				return;
			}
		}

		const note = new FloatingStickyNote(this.plugin.app, this.plugin, options);
		note.load();

		// 给一点额外时间让设置/文件持久化完成，并触发所有便签视图刷新
		const timer = window.setTimeout(() => {
			this.refreshImmersiveNotes();
		}, 200);
		this.plugin.register(() => window.clearTimeout(timer));
	}

	public refreshImmersiveNotes() {
		// 触发全局便签变更事件，通知所有便签视图（包括 ImmersiveStickyNotesView 和 WorkbenchView）
		this.plugin.app.workspace.trigger('webnovel:notes-changed');
	}

}
