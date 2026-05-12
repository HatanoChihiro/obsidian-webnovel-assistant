import { StickyNoteState } from '../types/settings';
import { SerializedWriter } from '../utils/SerializedWriter';
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
		this.notesFilePath = `${plugin.manifest.dir}/notes-data.json`;
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
				const parsed = JSON.parse(content);
				const rawNotes = Array.isArray(parsed) ? parsed : [];
				
				// [BUGFIX] 验证每个条目的结构，确保至少有 id
				this.notesData = rawNotes.filter(n => n && typeof n === 'object' && typeof n.id === 'string');
				
				if (this.notesData.length !== rawNotes.length) {
					console.warn(`[StickyNoteDataManager] 过滤掉 ${rawNotes.length - this.notesData.length} 个无效便签条目`);
				}
				
				console.log(`[StickyNoteDataManager] 已从独立文件加载 ${this.notesData.length} 个便签`);
				return this.notesData;
			}


			console.log("[StickyNoteDataManager] 未发现现有便签数据");
			return [];
		} catch (error) {
			console.error("[StickyNoteDataManager] 加载便签数据失败:", error);
			return [];
		}
	}

	/**
	 * 保存便签数据
	 */
	async saveNotes(notes: StickyNoteState[]): Promise<void> {
		this.notesData = notes;
		
		// 使用串行写入器确保顺序写入，防止文件损坏
		return this.writer.enqueue(async () => {
			try {
				const adapter = this.plugin.app.vault.adapter;
				this._isWriting = true;
				const content = JSON.stringify(this.notesData, null, 2);
				await adapter.write(this.notesFilePath, content);
				this._isWriting = false;
				// 触发全局事件，通知其他组件同步数据
				this.plugin.app.workspace.trigger('webnovel:notes-changed');
			} catch (error) {
				console.error("[StickyNoteDataManager] 保存便签数据失败:", error);
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
	 * 更新单个便签数据（自动触发持久化）
	 */
	updateNote(noteState: StickyNoteState): void {
		const index = this.notesData.findIndex(n => n.id === noteState.id);
		if (index !== -1) {
			this.notesData[index] = { ...noteState };
		} else {
			this.notesData.push({ ...noteState });
		}
		
		// 自动触发持久化，不再显式设置 dirty=true，交给 saveNotes 处理
		this.saveNotes(this.notesData).catch(err => {
			console.error('[StickyNoteDataManager] updateNote 自动保存失败:', err);
		});
	}

	/**
	 * 强制等待所有待处理的保存操作完成
	 * 主要用于 onunload 生命周期
	 */
	async flush(): Promise<void> {
		await this.writer.flush();
	}

	/**
	 * 移除便签（自动触发持久化）
	 */
	removeNote(id: string): void {
		this.notesData = this.notesData.filter(n => n.id !== id);
		this.saveNotes(this.notesData).catch(err => {
			console.error('[StickyNoteDataManager] removeNote 自动保存失败:', err);
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

}
