import { describe, it, expect } from 'vitest';
import {
	parseWritingJourneyLog,
	type ChapterStatusChangedEvent,
	type WritingJourneyLog
} from '../src/types/writingJourney';

describe('Writing Journey Snapshot Schema & Compatibility Regressions', () => {
	it('should parse v1 logs without snapshot references unchanged', () => {
		const rawV1: WritingJourneyLog = {
			version: 1,
			events: [
				{
					id: 'ev-1',
					type: 'chapter.status_changed',
					timestamp: '2026-10-22T10:00:00.000Z',
					path: 'Novel/Chapter1.md',
					chapterTitle: 'Chapter 1',
					fromStatus: 'unwritten',
					toStatus: 'writing',
					wordCount: 1500
				}
			]
		};

		const result = parseWritingJourneyLog(rawV1);
		expect(result.status).toBe('valid');
		expect(result.log?.version).toBe(1);
		expect(result.log?.events.length).toBe(1);
		const ev = result.log?.events[0] as ChapterStatusChangedEvent;
		expect(ev.snapshot).toBeUndefined();
	});

	it('should parse v2 logs with valid snapshot reference', () => {
		const rawV2 = {
			version: 2,
			events: [
				{
					id: 'ev-2',
					type: 'chapter.status_changed',
					timestamp: '2026-10-22T10:00:00.000Z',
					path: 'Novel/Chapter1.md',
					chapterTitle: 'Chapter 1',
					fromStatus: 'writing',
					toStatus: 'completed',
					wordCount: 3000,
					snapshot: {
						provider: 'file-recovery',
						deviceId: 'dev-123',
						dbName: 'vault-backup',
						key: 42,
						path: 'Novel/Chapter1.md',
						ts: 1729591200000,
						digest: 'a'.repeat(64)
					}
				}
			]
		};

		const result = parseWritingJourneyLog(rawV2);
		expect(result.status).toBe('valid');
		expect(result.log?.version).toBe(2);
		const ev = result.log?.events[0] as ChapterStatusChangedEvent;
		expect(ev.snapshot).toBeDefined();
		expect(ev.snapshot?.key).toBe(42);
		expect(ev.snapshot?.digest).toBe('a'.repeat(64));
	});

	it('should safely reject unknown future versions (e.g. version 3)', () => {
		const rawV3 = {
			version: 3,
			events: []
		};
		const result = parseWritingJourneyLog(rawV3);
		expect(result.status).toBe('malformed');
		expect(result.error).toMatch(/unsupported.*version/i);
	});

	it('should reject malformed snapshot reference without data loss or corruption', () => {
		const rawBadSnapshot = {
			version: 2,
			events: [
				{
					id: 'ev-bad',
					type: 'chapter.status_changed',
					timestamp: '2026-10-22T10:00:00.000Z',
					path: 'Novel/Chapter1.md',
					chapterTitle: 'Chapter 1',
					fromStatus: 'writing',
					toStatus: 'completed',
					snapshot: {
						provider: 'invalid-provider', // wrong provider
						key: 'not-a-number'
					}
				}
			]
		};
		const result = parseWritingJourneyLog(rawBadSnapshot);
		expect(result.status).toBe('malformed');
	});
});
