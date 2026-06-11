/**
 * 创作主页相关类型定义
 */

export interface NovelInfoSettings {
	fileName: string;
}

export interface NovelMetadata {
	name: string;
	status: 'ongoing' | 'stockpiling' | 'paused' | 'completed';
	synopsis: string;
	protagonist: string;
	wordGoal: number;
	genre: string;
	startDate: string;
	endDate: string;
}

export interface NovelFolderInfo {
	folderPath: string;
	folderName: string;
	metadata: NovelMetadata | null;
	wordCount: number;
}