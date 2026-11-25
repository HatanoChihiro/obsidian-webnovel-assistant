import type { TFile } from 'obsidian';
import type { ForeshadowingStatus } from './foreshadowing';
import type { TimelineEntry } from '../services/TimelineManager';

export type ReferenceType = 'timeline' | 'foreshadowing';

export interface TimelineReferenceTarget {
	folderPath: string;
	sourcePath: string;
	itemIndex: number;
	expectedEntry: TimelineEntry;
}

export interface ForeshadowingReferenceTarget {
	sourcePath: string;
	rawBlock: string;
}

export interface BaseReferenceItem {
	id: string;
	type: ReferenceType;
	quote: string;
	description: string;
	time?: string;
	important?: boolean;
	sourceFile: TFile;
	recordText?: string;
}

export interface TimelineReferenceItem extends BaseReferenceItem {
	type: 'timeline';
	eventType?: string;
	lores?: string[];
	timelineTarget?: TimelineReferenceTarget;
}

export interface ForeshadowingReferenceItem extends BaseReferenceItem {
	type: 'foreshadowing';
	kind: 'creation' | 'recovery';
	status: ForeshadowingStatus;
	tags: string[];
	stageType?: 'stage' | 'final';
	note?: string;
	foreshadowingTarget?: ForeshadowingReferenceTarget;
}

export type ChapterReferenceItem = TimelineReferenceItem | ForeshadowingReferenceItem;

export interface ReferenceCluster {
	from: number;
	to: number;
	items: ChapterReferenceItem[];
}
