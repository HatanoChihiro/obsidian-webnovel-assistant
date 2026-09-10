/**
 * 作品写作历程相关类型与 Schema 定义
 */

export const WRITING_JOURNEY_SCHEMA_VERSION = 1;
export const WRITING_JOURNEY_YAML_KEY = 'webnovel-writing-journey';

export type WritingJourneyEventType =
	| 'work.created'
	| 'work.imported'
	| 'tracking.started'
	| 'chapter.created'
	| 'chapter.renamed'
	| 'chapter.moved'
	| 'chapter.deleted'
	| 'chapter.status_changed'
	| 'work.status_changed';

export interface BaseJourneyEvent {
	id: string;
	type: WritingJourneyEventType;
	timestamp: string; // ISO 8601 UTC string
}

export interface WorkCreatedEvent extends BaseJourneyEvent {
	type: 'work.created';
	workTitle: string;
}

export interface WorkImportedEvent extends BaseJourneyEvent {
	type: 'work.imported';
	workTitle: string;
	chapterCount?: number;
}

export interface TrackingStartedEvent extends BaseJourneyEvent {
	type: 'tracking.started';
}

export interface ChapterCreatedEvent extends BaseJourneyEvent {
	type: 'chapter.created';
	path: string;
	chapterTitle: string;
	source?: 'workbench' | 'create-next' | 'import' | 'split' | 'manual' | 'vault';
}

export interface ChapterRenamedEvent extends BaseJourneyEvent {
	type: 'chapter.renamed';
	oldPath: string;
	newPath: string;
	oldTitle: string;
	newTitle: string;
}

export interface ChapterMovedEvent extends BaseJourneyEvent {
	type: 'chapter.moved';
	oldPath: string;
	newPath: string;
	chapterTitle: string;
}

export interface ChapterDeletedEvent extends BaseJourneyEvent {
	type: 'chapter.deleted';
	path: string;
	chapterTitle: string;
}

export interface ChapterStatusChangedEvent extends BaseJourneyEvent {
	type: 'chapter.status_changed';
	path: string;
	chapterTitle: string;
	fromStatus: string;
	toStatus: string;
	wordCount?: number;
}

export interface WorkStatusChangedEvent extends BaseJourneyEvent {
	type: 'work.status_changed';
	fromStatus: string;
	toStatus: string;
}

export type WritingJourneyEvent =
	| WorkCreatedEvent
	| WorkImportedEvent
	| TrackingStartedEvent
	| ChapterCreatedEvent
	| ChapterRenamedEvent
	| ChapterMovedEvent
	| ChapterDeletedEvent
	| ChapterStatusChangedEvent
	| WorkStatusChangedEvent;

export interface WritingJourneyLog {
	version: 1;
	events: WritingJourneyEvent[];
}

export interface WritingJourneyParseResult {
	status: 'empty' | 'valid' | 'malformed';
	log: WritingJourneyLog | null;
	error?: string;
}

const VALID_EVENT_TYPES = new Set<WritingJourneyEventType>([
	'work.created',
	'work.imported',
	'tracking.started',
	'chapter.created',
	'chapter.renamed',
	'chapter.moved',
	'chapter.deleted',
	'chapter.status_changed',
	'work.status_changed'
]);

const VALID_CHAPTER_SOURCES = new Set<string>([
	'workbench',
	'create-next',
	'import',
	'split',
	'manual',
	'vault'
]);

function isIsoUtcTimestamp(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
		return false;
	}
	const parsed = new Date(value);
	if (isNaN(parsed.getTime())) return false;
	const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
	return parsed.toISOString() === canonical;
}

/**
 * 校验 raw frontmatter 中的 webnovel-writing-journey 字段
 */
export function parseWritingJourneyLog(raw: unknown): WritingJourneyParseResult {
	if (raw === undefined || raw === null) {
		return { status: 'empty', log: null };
	}

	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return { status: 'malformed', log: null, error: 'writing-journey frontmatter field must be an object' };
	}

	const record = raw as Record<string, unknown>;

	if (record.version !== WRITING_JOURNEY_SCHEMA_VERSION) {
		return {
			status: 'malformed',
			log: null,
			error: `Unsupported writing-journey schema version: ${String(record.version)}`
		};
	}

	const rawEvents = record.events;
	if (!Array.isArray(rawEvents)) {
		return { status: 'malformed', log: null, error: 'writing-journey events must be an array' };
	}

	const eventsArray: readonly unknown[] = rawEvents;
	const validatedEvents: WritingJourneyEvent[] = [];

	for (let i = 0; i < eventsArray.length; i++) {
		const ev: unknown = eventsArray[i];
		if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) {
			return { status: 'malformed', log: null, error: `Event at index ${i} is not a valid object` };
		}
		const eventObj = ev as Record<string, unknown>;

		const id = eventObj.id;
		if (typeof id !== 'string' || id.trim().length === 0) {
			return { status: 'malformed', log: null, error: `Event at index ${i} lacks valid non-empty id` };
		}

		const timestamp = eventObj.timestamp;
		if (!isIsoUtcTimestamp(timestamp)) {
			return { status: 'malformed', log: null, error: `Event at index ${i} lacks valid ISO timestamp` };
		}

		const type = eventObj.type;
		if (typeof type !== 'string' || !VALID_EVENT_TYPES.has(type as WritingJourneyEventType)) {
			return { status: 'malformed', log: null, error: `Event at index ${i} has unknown type: ${String(type)}` };
		}

		switch (type as WritingJourneyEventType) {
			case 'work.created': {
				const workTitle = eventObj.workTitle;
				if (typeof workTitle !== 'string') {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks workTitle` };
				}
				validatedEvents.push({ id, timestamp, type: 'work.created', workTitle });
				break;
			}
			case 'work.imported': {
				const workTitle = eventObj.workTitle;
				if (typeof workTitle !== 'string') {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks workTitle` };
				}
				const chapterCount = eventObj.chapterCount;
				if (chapterCount !== undefined && typeof chapterCount !== 'number') {
					return { status: 'malformed', log: null, error: `Event at index ${i} has invalid chapterCount` };
				}
				validatedEvents.push({ id, timestamp, type: 'work.imported', workTitle, chapterCount });
				break;
			}
			case 'tracking.started': {
				validatedEvents.push({ id, timestamp, type: 'tracking.started' });
				break;
			}
			case 'chapter.created': {
				const chapterPath = eventObj.path;
				const chapterTitle = eventObj.chapterTitle;
				if (typeof chapterPath !== 'string' || typeof chapterTitle !== 'string') {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks path or chapterTitle` };
				}
				const source = eventObj.source;
				if (source !== undefined && (typeof source !== 'string' || !VALID_CHAPTER_SOURCES.has(source))) {
					return { status: 'malformed', log: null, error: `Event at index ${i} has invalid source` };
				}
				validatedEvents.push({
					id,
					timestamp,
					type: 'chapter.created',
					path: chapterPath,
					chapterTitle,
					source: source as ChapterCreatedEvent['source']
				});
				break;
			}
			case 'chapter.renamed': {
				const oldPath = eventObj.oldPath;
				const newPath = eventObj.newPath;
				const oldTitle = eventObj.oldTitle;
				const newTitle = eventObj.newTitle;
				if (
					typeof oldPath !== 'string' ||
					typeof newPath !== 'string' ||
					typeof oldTitle !== 'string' ||
					typeof newTitle !== 'string'
				) {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks rename fields` };
				}
				validatedEvents.push({ id, timestamp, type: 'chapter.renamed', oldPath, newPath, oldTitle, newTitle });
				break;
			}
			case 'chapter.moved': {
				const oldPath = eventObj.oldPath;
				const newPath = eventObj.newPath;
				const chapterTitle = eventObj.chapterTitle;
				if (typeof oldPath !== 'string' || typeof newPath !== 'string' || typeof chapterTitle !== 'string') {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks move fields` };
				}
				validatedEvents.push({ id, timestamp, type: 'chapter.moved', oldPath, newPath, chapterTitle });
				break;
			}
			case 'chapter.deleted': {
				const chapterPath = eventObj.path;
				const chapterTitle = eventObj.chapterTitle;
				if (typeof chapterPath !== 'string' || typeof chapterTitle !== 'string') {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks path or chapterTitle` };
				}
				validatedEvents.push({ id, timestamp, type: 'chapter.deleted', path: chapterPath, chapterTitle });
				break;
			}
			case 'chapter.status_changed': {
				const chapterPath = eventObj.path;
				const chapterTitle = eventObj.chapterTitle;
				const fromStatus = eventObj.fromStatus;
				const toStatus = eventObj.toStatus;
				if (
					typeof chapterPath !== 'string' ||
					typeof chapterTitle !== 'string' ||
					typeof fromStatus !== 'string' ||
					typeof toStatus !== 'string'
				) {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks status fields` };
				}
				const wordCount = eventObj.wordCount;
				if (
					wordCount !== undefined &&
					(typeof wordCount !== 'number' || !Number.isFinite(wordCount) || wordCount < 0)
				) {
					return { status: 'malformed', log: null, error: `Event at index ${i} has invalid wordCount` };
				}
				const validatedStatusEvent: ChapterStatusChangedEvent = {
					id,
					timestamp,
					type: 'chapter.status_changed',
					path: chapterPath,
					chapterTitle,
					fromStatus,
					toStatus
				};
				if (wordCount !== undefined) {
					validatedStatusEvent.wordCount = wordCount;
				}
				validatedEvents.push(validatedStatusEvent);
				break;
			}
			case 'work.status_changed': {
				const fromStatus = eventObj.fromStatus;
				const toStatus = eventObj.toStatus;
				if (typeof fromStatus !== 'string' || typeof toStatus !== 'string') {
					return { status: 'malformed', log: null, error: `Event at index ${i} lacks work status fields` };
				}
				validatedEvents.push({ id, timestamp, type: 'work.status_changed', fromStatus, toStatus });
				break;
			}
		}
	}

	return {
		status: 'valid',
		log: {
			version: WRITING_JOURNEY_SCHEMA_VERSION,
			events: validatedEvents
		}
	};
}
