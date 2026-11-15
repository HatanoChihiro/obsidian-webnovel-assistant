import type { TFile } from 'obsidian';
import type { ForeshadowingStatus } from './foreshadowing';

export type ReferenceType = 'timeline' | 'foreshadowing';

export interface BaseReferenceItem {
	id: string;
	type: ReferenceType;
	quote: string;
	description: string;
	time?: string;
	sourceFile: TFile;
	recordText?: string;
}

export interface TimelineReferenceItem extends BaseReferenceItem {
	type: 'timeline';
	eventType?: string;
	important?: boolean;
	lores?: string[];
}

export interface ForeshadowingReferenceItem extends BaseReferenceItem {
	type: 'foreshadowing';
	kind: 'creation' | 'recovery';
	status: ForeshadowingStatus;
	tags: string[];
	stageType?: 'stage' | 'final';
	note?: string;
}

export type ChapterReferenceItem = TimelineReferenceItem | ForeshadowingReferenceItem;

export interface ReferenceCluster {
	from: number;
	to: number;
	items: ChapterReferenceItem[];
}
