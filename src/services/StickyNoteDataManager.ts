import { StickyNoteState } from '../types/settings';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 便签数据管理器
 * 负责将便签内容持久化到独立的 notes-data.json 文件中，避免 data.json 过大
 */
export class StickyNoteDataManager {
	private notesData: StickyNoteState[] = [];
	private plugin: WebNovelAssistantPlugin;
	private notesFilePath: string;
	private saveQueue: Promise<void> = Promise.resolve();
	private dirty: boolean = false;

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
				this.notesData = JSON.parse(content);
				console.log(`[StickyNoteDataManager] 已从独立文件加载 ${this.notesData.length} 个便签`);
				return this.notesData;
			}

			// 2. 迁移逻辑：如果独立文件不存在，检查 settings 中是否有旧数据
			const settings = (this.plugin as any).settings;
			if (settings && settings.openNotes && settings.openNotes.length > 0) {
				console.log(`[StickyNoteDataManager] 检测到旧版便签数据，开始迁移...`);
				this.notesData = [...settings.openNotes];
				this.dirty = true;
				
				// 标记迁移成功，保存到新文件并从旧设置中移除
				await this.saveNotes(this.notesData);
				
				// 注意：这里先不从 settings 中彻底删除，交给 main.ts 在启动完成后统一处理，确保安全
				console.log(`[StickyNoteDataManager] 已迁移 ${this.notesData.length} 个便签到独立文件`);
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
		this.dirty = true;
		
		// 使用队列确保顺序写入，防止文件损坏
		this.saveQueue = this.saveQueue.then(async () => {
			if (!this.dirty) return;
			
			try {
				const adapter = this.plugin.app.vault.adapter;
				const content = JSON.stringify(this.notesData, null, 2);
				await adapter.write(this.notesFilePath, content);
				this.dirty = false;
				// 触发全局事件，通知其他组件同步数据
				this.plugin.app.workspace.trigger('webnovel:notes-changed');
			} catch (error) {
				console.error("[StickyNoteDataManager] 保存便签数据失败:", error);
			}
		});
		
		return this.saveQueue;
	}

	/**
	 * 获取当前内存中的便签数据
	 */
	getNotes(): StickyNoteState[] {
		return this.notesData;
	}

	/**
	 * 更新单个便签数据
	 */
	updateNote(noteState: StickyNoteState): void {
		const index = this.notesData.findIndex(n => n.id === noteState.id);
		if (index !== -1) {
			this.notesData[index] = { ...noteState };
		} else {
			this.notesData.push({ ...noteState });
		}
		this.dirty = true;
	}

	/**
	 * 移除便签
	 */
	removeNote(id: string): void {
		this.notesData = this.notesData.filter(n => n.id !== id);
		this.dirty = true;
	}

	/**
	 * 检查是否有未保存的更改
	 */
	isDirty(): boolean {
		return this.dirty;
	}
}
